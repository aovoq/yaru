package golden

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const (
	defaultGitUserName  = "golden"
	defaultGitUserEmail = "golden@example.com"
	// 手順が now を省いても壁時計を使わない。上書きは手順の now か environment.YARU_NOW
	defaultNow = "2026-09-28T00:00:00.000Z"
	// 暦日と日時の表示は OS の時間帯を見る。既定を固定し、手順の TZ で上書きできる
	defaultTimeZone = "Asia/Tokyo"
	// 準備の commit の時刻を固定し、作者の日付が記録に混ざらないようにする
	setupCommitDate = "2026-09-28T00:00:00Z"
)

// 本物の .yaru を持つ元のフォルダ。ここへは決して書かない
//
//declscope:package
const mainWorktree = "/Users/voq/ghq/github.com/aovoq/yaru"

// 親の環境から子へ渡すもの。セッション ID や YARU_STATE_DIR が記録のたびに変わると、同じ場面でも golden がずれる
var passedEnvironment = []string{"PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP", "SHELL"}

// 手順の environment から記録に残さないもの。TZ は別に必ず残す
var unrecordedEnvironment = map[string]bool{
	"TZ":                  true,
	"YARU_NOW":            true,
	"YARU_STATE_DIR":      true,
	"HOME":                true,
	"GIT_CONFIG_GLOBAL":   true,
	"GIT_CONFIG_NOSYSTEM": true,
}

// Runner は場面を 1 つずつ、使い捨ての一時ディレクトリで CLI に流す
type Runner struct {
	// CLI の実行ファイル。引数は含まない
	Command string
	// このリポジトリの根。記録では <REPOSITORY> にし、ここへは書かない
	RepositoryDirectory string
}

func (runner Runner) Run(scenario Scenario) (snapshot Snapshot, err error) {
	parent, err := os.MkdirTemp("", "yaru-golden-")
	if err != nil {
		return Snapshot{}, err
	}
	// 片付けに失敗したら、一時ディレクトリが残ったことを結果として返す
	defer func() {
		if removeError := os.RemoveAll(parent); removeError != nil && err == nil {
			err = removeError
		}
	}()
	directories := map[string]string{}
	for _, name := range []string{"workspace", "state", "home"} {
		if err := os.Mkdir(filepath.Join(parent, name), 0o755); err != nil {
			return Snapshot{}, err
		}
		// git は実パスを返す。子に渡すパスと揃えないと、登録ファイルに同じ場所が 2 行出る
		resolved, err := filepath.EvalSymlinks(filepath.Join(parent, name))
		if err != nil {
			return Snapshot{}, err
		}
		if err := AssertIsolated(resolved, runner.RepositoryDirectory); err != nil {
			return Snapshot{}, err
		}
		directories[name] = resolved
	}
	workspaceDirectory := directories["workspace"]
	stateDirectory := directories["state"]
	homeDirectory := directories["home"]
	worktrees, err := prepareWorkspace(workspaceDirectory, homeDirectory, scenario.Setup)
	if err != nil {
		return Snapshot{}, err
	}
	repositoryDirectory, err := filepath.EvalSymlinks(runner.RepositoryDirectory)
	if err != nil {
		return Snapshot{}, err
	}
	bindings := Bindings{
		WorkspaceDirectory:  workspaceDirectory,
		StateDirectory:      stateDirectory,
		Worktrees:           worktrees,
		RepositoryDirectory: repositoryDirectory,
		HomeDirectory:       homeDirectory,
		Commits:             readCommits(workspaceDirectory, homeDirectory),
	}
	steps := []RecordedStep{}
	for _, step := range scenario.Steps {
		workingDirectory, err := resolveWorkingDirectory(scenario.Name, workspaceDirectory, worktrees, step.WorkingDirectory)
		if err != nil {
			return Snapshot{}, err
		}
		environment, err := childEnvironment(stateDirectory, homeDirectory, step)
		if err != nil {
			return Snapshot{}, err
		}
		command := exec.Command(runner.Command, step.Arguments...)
		command.Dir = workingDirectory
		command.Env = environment
		// 空でもパイプで渡す。nil だと /dev/null になり、端末かパイプかを見る CLI の動きが変わる
		command.Stdin = strings.NewReader(valueOrEmpty(step.Stdin))
		var stdout, stderr bytes.Buffer
		command.Stdout = &stdout
		command.Stderr = &stderr
		exitCode := 0
		if err := command.Run(); err != nil {
			var exitError *exec.ExitError
			if !errors.As(err, &exitError) || exitError.ExitCode() < 0 {
				return Snapshot{}, fmt.Errorf("command did not exit: expected an exit code, actual %v", err)
			}
			exitCode = exitError.ExitCode()
		}
		recorded := recordedInputs(step)
		recorded.Stdout = NormalizeText(decodeUTF8(stdout.Bytes()), bindings)
		recorded.Stderr = NormalizeText(decodeUTF8(stderr.Bytes()), bindings)
		recorded.ExitCode = exitCode
		steps = append(steps, recorded)
	}
	yaruFiles, err := readTree(filepath.Join(workspaceDirectory, ".yaru"), bindings)
	if err != nil {
		return Snapshot{}, err
	}
	stateFiles, err := readTree(stateDirectory, bindings)
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Name: scenario.Name, Steps: steps, Yaru: yaruFiles, State: stateFiles}, nil
}

func prepareWorkspace(workspaceDirectory string, homeDirectory string, setup *Setup) ([]WorktreeBinding, error) {
	if setup == nil {
		setup = &Setup{}
	}
	templateDirectory := filepath.Join(filepath.Dir(workspaceDirectory), "git-template")
	if err := os.MkdirAll(templateDirectory, 0o755); err != nil {
		return nil, err
	}
	gitUser := GitUser{Name: defaultGitUserName, Email: defaultGitUserEmail}
	if setup.GitUser != nil {
		gitUser = *setup.GitUser
	}
	for _, arguments := range [][]string{
		{"init", "--quiet", "--initial-branch", "main", "--template", templateDirectory},
		{"config", "user.name", gitUser.Name},
		{"config", "user.email", gitUser.Email},
		{"config", "core.abbrev", "7"},
	} {
		if err := git(workspaceDirectory, homeDirectory, arguments, nil); err != nil {
			return nil, err
		}
	}
	for _, file := range setup.Files {
		destination, err := resolveInside(workspaceDirectory, file.Path)
		if err != nil {
			return nil, err
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(destination, []byte(file.Content), 0o644); err != nil {
			return nil, err
		}
	}
	for _, commit := range setup.Commits {
		paths := commit.Paths
		if paths == nil {
			paths = []string{"."}
		}
		for _, path := range paths {
			if _, err := resolveInside(workspaceDirectory, path); err != nil {
				return nil, err
			}
		}
		if err := git(workspaceDirectory, homeDirectory, append([]string{"add", "--"}, paths...), nil); err != nil {
			return nil, err
		}
		commitEnvironment := []string{
			"GIT_AUTHOR_NAME=" + gitUser.Name,
			"GIT_AUTHOR_EMAIL=" + gitUser.Email,
			"GIT_COMMITTER_NAME=" + gitUser.Name,
			"GIT_COMMITTER_EMAIL=" + gitUser.Email,
			"GIT_AUTHOR_DATE=" + setupCommitDate,
			"GIT_COMMITTER_DATE=" + setupCommitDate,
		}
		if err := git(workspaceDirectory, homeDirectory, []string{"commit", "--quiet", "--allow-empty", "-m", commit.Message}, commitEnvironment); err != nil {
			return nil, err
		}
	}
	worktrees := []WorktreeBinding{}
	for _, worktree := range setup.Worktrees {
		if len(setup.Commits) == 0 {
			return nil, fmt.Errorf("worktree %s: expected at least one commit, actual none", worktree.Name)
		}
		if !scenarioNamePattern.MatchString(worktree.Name) {
			return nil, fmt.Errorf("invalid worktree name: expected lowercase words separated by hyphens, actual %s", quote(worktree.Name))
		}
		directory := filepath.Join(filepath.Dir(workspaceDirectory), "worktrees", worktree.Name)
		if err := os.MkdirAll(filepath.Dir(directory), 0o755); err != nil {
			return nil, err
		}
		if err := git(workspaceDirectory, homeDirectory, []string{"worktree", "add", "--quiet", "-b", worktree.Branch, directory}, nil); err != nil {
			return nil, err
		}
		resolved, err := filepath.EvalSymlinks(directory)
		if err != nil {
			return nil, err
		}
		worktrees = append(worktrees, WorktreeBinding{Name: worktree.Name, Directory: resolved})
	}
	return worktrees, nil
}

func resolveWorkingDirectory(scenarioName string, workspaceDirectory string, worktrees []WorktreeBinding, workingDirectory *string) (string, error) {
	resolved := workspaceDirectory
	if workingDirectory != nil && *workingDirectory != "." {
		if name, isWorktree := strings.CutPrefix(*workingDirectory, "worktree:"); isWorktree {
			found := false
			names := []string{}
			for _, worktree := range worktrees {
				names = append(names, worktree.Name)
				if worktree.Name == name {
					resolved = worktree.Directory
					found = true
				}
			}
			if !found {
				listed := strings.Join(names, ", ")
				if listed == "" {
					listed = "(none)"
				}
				return "", fmt.Errorf("unknown worktree: expected one of %s, actual %s", listed, quote(name))
			}
		} else {
			inside, err := resolveInside(workspaceDirectory, *workingDirectory)
			if err != nil {
				return "", err
			}
			resolved = inside
		}
	}
	if _, err := os.Stat(resolved); err != nil {
		return "", fmt.Errorf("%s: workingDirectory not found: expected %s, actual missing", scenarioName, resolved)
	}
	return resolved, nil
}

// recordedInputs は記録に残す入力。省いた項目は既定の値にする
func recordedInputs(step Step) RecordedStep {
	environment := map[string]string{"TZ": defaultTimeZone}
	if timeZone, present := step.Environment["TZ"]; present {
		environment["TZ"] = timeZone
	}
	for key, value := range step.Environment {
		if unrecordedEnvironment[key] {
			continue
		}
		environment[key] = value
	}
	now := defaultNow
	if step.Now != nil {
		now = *step.Now
	} else if value, present := step.Environment["YARU_NOW"]; present {
		now = value
	}
	workingDirectory := "."
	if step.WorkingDirectory != nil {
		workingDirectory = *step.WorkingDirectory
	}
	arguments := step.Arguments
	if arguments == nil {
		arguments = []string{}
	}
	return RecordedStep{
		Arguments:        arguments,
		Stdin:            valueOrEmpty(step.Stdin),
		Environment:      environment,
		Now:              now,
		WorkingDirectory: workingDirectory,
	}
}

func resolveInside(root string, relativePath string) (string, error) {
	if relativePath == "." {
		return root, nil
	}
	if strings.HasPrefix(relativePath, "/") || strings.Contains(relativePath, "\x00") {
		return "", fmt.Errorf("invalid path: expected a relative path, actual %s", quote(relativePath))
	}
	resolved := filepath.Join(root, relativePath)
	if !isInside(root, resolved) {
		return "", fmt.Errorf("invalid path: expected a path inside the workspace, actual %s", quote(relativePath))
	}
	return resolved, nil
}

func childEnvironment(stateDirectory string, homeDirectory string, step Step) ([]string, error) {
	if _, present := step.Environment["YARU_STATE_DIR"]; present {
		return nil, errors.New("invalid environment: expected no YARU_STATE_DIR, actual the step sets YARU_STATE_DIR")
	}
	environment := isolatedEnvironment(homeDirectory)
	environment["YARU_NOW"] = defaultNow
	for key, value := range step.Environment {
		environment[key] = value
	}
	if nowInEnvironment, present := step.Environment["YARU_NOW"]; present && step.Now != nil && nowInEnvironment != *step.Now {
		return nil, fmt.Errorf("invalid now: expected YARU_NOW to match now, actual environment %s and now %s", quote(nowInEnvironment), quote(*step.Now))
	}
	if step.Now != nil {
		environment["YARU_NOW"] = *step.Now
	}
	environment["YARU_STATE_DIR"] = stateDirectory
	environment["HOME"] = homeDirectory
	environment["GIT_CONFIG_GLOBAL"] = "/dev/null"
	environment["GIT_CONFIG_NOSYSTEM"] = "1"
	return environmentList(environment), nil
}

// isolatedEnvironment は git に本物の HOME も全体設定も渡さない環境
func isolatedEnvironment(homeDirectory string) map[string]string {
	environment := map[string]string{}
	for _, key := range passedEnvironment {
		if value, present := os.LookupEnv(key); present {
			environment[key] = value
		}
	}
	environment["HOME"] = homeDirectory
	environment["GIT_CONFIG_GLOBAL"] = "/dev/null"
	environment["GIT_CONFIG_NOSYSTEM"] = "1"
	environment["TZ"] = defaultTimeZone
	return environment
}

func environmentList(environment map[string]string) []string {
	keys := make([]string, 0, len(environment))
	for key := range environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	list := make([]string, 0, len(keys))
	for _, key := range keys {
		list = append(list, key+"="+environment[key])
	}
	return list
}

func git(workingDirectory string, homeDirectory string, arguments []string, extraEnvironment []string) error {
	command := exec.Command("git", arguments...)
	command.Dir = workingDirectory
	command.Env = append(environmentList(isolatedEnvironment(homeDirectory)), extraEnvironment...)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		exitCode := "signal"
		var exitError *exec.ExitError
		if errors.As(err, &exitError) && exitError.ExitCode() >= 0 {
			exitCode = fmt.Sprint(exitError.ExitCode())
		}
		return fmt.Errorf("git %s failed: expected exit code 0, actual %s %s", strings.Join(arguments, " "), exitCode, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func readCommits(workspaceDirectory string, homeDirectory string) []CommitBinding {
	command := exec.Command("git", "log", "--all", "--reverse", "--format=%H%x09%h")
	command.Dir = workspaceDirectory
	command.Env = environmentList(isolatedEnvironment(homeDirectory))
	output, err := command.Output()
	if err != nil {
		return []CommitBinding{}
	}
	commits := []CommitBinding{}
	for _, line := range strings.Split(string(output), "\n") {
		full, short, found := strings.Cut(line, "\t")
		if line == "" || !found {
			continue
		}
		commits = append(commits, CommitBinding{Full: full, Short: short})
	}
	return commits
}

// readTree はディレクトリの中のファイルを、パスの順に正規化して読む。空のディレクトリも残す
func readTree(root string, bindings Bindings) ([]RecordedFile, error) {
	files := []RecordedFile{}
	if _, err := os.Stat(root); err != nil {
		return files, nil
	}
	var visit func(directory string) error
	visit = func(directory string) error {
		entries, err := os.ReadDir(directory)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			absolute := filepath.Join(directory, entry.Name())
			relativePath, err := filepath.Rel(root, absolute)
			if err != nil {
				return err
			}
			portablePath := filepath.ToSlash(relativePath)
			switch {
			case entry.Type()&os.ModeSymlink != 0:
				return fmt.Errorf("unexpected symlink: expected a regular file, actual %s", absolute)
			case entry.IsDir():
				children, err := os.ReadDir(absolute)
				if err != nil {
					return err
				}
				if len(children) == 0 {
					files = append(files, RecordedFile{Path: portablePath, Content: "", Directory: true})
					continue
				}
				if err := visit(absolute); err != nil {
					return err
				}
			case entry.Type().IsRegular():
				content, err := os.ReadFile(absolute)
				if err != nil {
					return err
				}
				files = append(files, RecordedFile{Path: portablePath, Content: NormalizeText(decodeUTF8(content), bindings)})
			}
		}
		return nil
	}
	if err := visit(root); err != nil {
		return nil, err
	}
	// JS の文字列比較は UTF-16 の符号単位の順。パスは ASCII なのでバイトの順と同じになる
	sort.Slice(files, func(left int, right int) bool {
		return files[left].Path < files[right].Path
	})
	return files, nil
}

// AssertIsolated はリポジトリ、元のフォルダ、本物の状態ディレクトリの中を拒む
func AssertIsolated(directory string, repositoryDirectory string) error {
	resolved, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return err
	}
	repository, err := filepath.EvalSymlinks(repositoryDirectory)
	if err != nil {
		return err
	}
	if isInside(repository, resolved) {
		return fmt.Errorf("refusing to touch the repository: expected a temp directory, actual %s", resolved)
	}
	if resolvedMain, err := filepath.EvalSymlinks(mainWorktree); err == nil && isInside(resolvedMain, resolved) {
		return fmt.Errorf("refusing to touch the main worktree: expected a temp directory, actual %s", resolved)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	if resolvedState, err := filepath.EvalSymlinks(filepath.Join(home, ".local", "state")); err == nil && isInside(resolvedState, resolved) {
		return fmt.Errorf("refusing to touch the real state directory: expected a temp directory, actual %s", resolved)
	}
	return nil
}

func isInside(parent string, child string) bool {
	relativePath, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	// TS 版と同じく、.. で始まる名前 (..notes など) も外として扱う
	return relativePath == "." || (!strings.HasPrefix(relativePath, "..") && !filepath.IsAbs(relativePath))
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
