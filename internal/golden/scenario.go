// CLI の golden。場面 (testdata/golden/scenarios) を CLI に流し、出力と .yaru と状態ディレクトリを記録 (testdata/golden/snapshots) と突き合わせる
// 書き方と決まりは testdata/golden/README.md
package golden

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// 場面と記録は JSON
// https://www.rfc-editor.org/rfc/rfc8259

type Scenario struct {
	Name        string
	Description string
	Setup       *Setup
	Steps       []Step
}

type Setup struct {
	Files     []File
	Commits   []Commit
	Worktrees []Worktree
	GitUser   *GitUser
}

type File struct {
	Path    string
	Content string
}

// Paths が nil なら全体を commit する
type Commit struct {
	Message string
	Paths   []string
}

type Worktree struct {
	Name   string
	Branch string
}

type GitUser struct {
	Name  string
	Email string
}

// 省いた項目は nil。記録では既定の値に置き換える
type Step struct {
	Arguments   []string
	Stdin       *string
	Environment map[string]string
	// ISO 8601 の日時 (RFC 3339)。CLI の YARU_NOW にそのまま渡す
	// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
	Now *string
	// "." はワークスペースの根。worktree:<名前> は準備で作った linked worktree
	WorkingDirectory *string
}

//declscope:package
var scenarioNamePattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

var (
	scenarioKeys = []string{"name", "description", "setup", "steps"}
	setupKeys    = []string{"files", "commits", "worktrees", "gitUser"}
	fileKeys     = []string{"path", "content"}
	commitKeys   = []string{"message", "paths"}
	worktreeKeys = []string{"name", "branch"}
	gitUserKeys  = []string{"name", "email"}
	stepKeys     = []string{"arguments", "stdin", "environment", "now", "workingDirectory"}
)

// LoadScenarios はディレクトリの *.json を名前の順に読む。知らないキーは場面名付きで拒む
func LoadScenarios(directory string) ([]Scenario, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("scenarios directory not found: expected a directory, actual %s", quote(directory))
	}
	names := []string{}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".json") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	scenarios := []Scenario{}
	for _, name := range names {
		content, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			return nil, err
		}
		scenario, err := parseScenario(name, content)
		if err != nil {
			return nil, err
		}
		scenarios = append(scenarios, scenario)
	}
	return scenarios, nil
}

func parseScenario(fileName string, content []byte) (Scenario, error) {
	fallback := strings.TrimSuffix(fileName, ".json")
	fields, keys, ok := decodeObject(content)
	if !ok {
		return Scenario{}, fmt.Errorf("%s: invalid scenario: expected an object, actual %s", fallback, compact(content))
	}
	scenarioName := fallback
	var declaredName string
	nameIsString := json.Unmarshal(fields["name"], &declaredName) == nil && isString(fields["name"])
	if nameIsString {
		scenarioName = declaredName
	}
	if err := assertKeys(scenarioName, "", keys, scenarioKeys); err != nil {
		return Scenario{}, err
	}
	if !nameIsString || declaredName != fallback {
		return Scenario{}, fmt.Errorf("invalid scenario name: expected %s, actual %s", fallback, compactOrUndefined(fields["name"]))
	}
	if !scenarioNamePattern.MatchString(scenarioName) {
		return Scenario{}, fmt.Errorf("invalid scenario name: expected lowercase words separated by hyphens, actual %s", quote(scenarioName))
	}
	var description string
	if !isString(fields["description"]) || json.Unmarshal(fields["description"], &description) != nil || strings.TrimSpace(description) == "" {
		return Scenario{}, fmt.Errorf("%s: invalid scenario description: expected a non-empty string, actual %s", scenarioName, compactOrUndefined(fields["description"]))
	}
	scenario := Scenario{Name: scenarioName, Description: description}
	if raw, present := fields["setup"]; present {
		setup, err := parseSetup(scenarioName, raw)
		if err != nil {
			return Scenario{}, err
		}
		scenario.Setup = &setup
	}
	steps, err := parseSteps(scenarioName, fields["steps"])
	if err != nil {
		return Scenario{}, err
	}
	scenario.Steps = steps
	return scenario, nil
}

func parseSetup(scenarioName string, raw json.RawMessage) (Setup, error) {
	fields, keys, ok := decodeObject(raw)
	if !ok {
		return Setup{}, fmt.Errorf("%s: invalid setup: expected an object, actual %s", scenarioName, compact(raw))
	}
	if err := assertKeys(scenarioName, "setup", keys, setupKeys); err != nil {
		return Setup{}, err
	}
	setup := Setup{}
	if raw, present := fields["files"]; present {
		items, ok := decodeArray(raw)
		if !ok {
			return Setup{}, fmt.Errorf("%s: invalid setup files: expected an array, actual %s", scenarioName, compact(raw))
		}
		for _, item := range items {
			file, err := parseFile(scenarioName, item)
			if err != nil {
				return Setup{}, err
			}
			setup.Files = append(setup.Files, file)
		}
	}
	if raw, present := fields["commits"]; present {
		items, ok := decodeArray(raw)
		if !ok {
			return Setup{}, fmt.Errorf("%s: invalid setup commits: expected an array, actual %s", scenarioName, compact(raw))
		}
		for _, item := range items {
			commit, err := parseCommit(scenarioName, item)
			if err != nil {
				return Setup{}, err
			}
			setup.Commits = append(setup.Commits, commit)
		}
	}
	if raw, present := fields["worktrees"]; present {
		items, ok := decodeArray(raw)
		if !ok {
			return Setup{}, fmt.Errorf("%s: invalid setup worktrees: expected an array, actual %s", scenarioName, compact(raw))
		}
		for _, item := range items {
			worktree, err := parseWorktree(scenarioName, item)
			if err != nil {
				return Setup{}, err
			}
			setup.Worktrees = append(setup.Worktrees, worktree)
		}
	}
	if raw, present := fields["gitUser"]; present {
		gitUser, err := parseGitUser(scenarioName, raw)
		if err != nil {
			return Setup{}, err
		}
		setup.GitUser = &gitUser
	}
	return setup, nil
}

func parseFile(scenarioName string, raw json.RawMessage) (File, error) {
	fields, keys, ok := decodeObject(raw)
	if !ok {
		return File{}, fmt.Errorf("%s: invalid setup file: expected an object, actual %s", scenarioName, compact(raw))
	}
	if err := assertKeys(scenarioName, "file", keys, fileKeys); err != nil {
		return File{}, err
	}
	path, pathOK := decodeString(fields["path"])
	content, contentOK := decodeString(fields["content"])
	if !pathOK || !contentOK {
		return File{}, fmt.Errorf("%s: invalid setup file: expected path and content strings, actual %s", scenarioName, compact(raw))
	}
	return File{Path: path, Content: content}, nil
}

func parseCommit(scenarioName string, raw json.RawMessage) (Commit, error) {
	fields, keys, ok := decodeObject(raw)
	if !ok {
		return Commit{}, fmt.Errorf("%s: invalid commit: expected an object, actual %s", scenarioName, compact(raw))
	}
	if err := assertKeys(scenarioName, "commit", keys, commitKeys); err != nil {
		return Commit{}, err
	}
	message, ok := decodeString(fields["message"])
	if !ok {
		return Commit{}, fmt.Errorf("%s: invalid commit message: expected a string, actual %s", scenarioName, compactOrUndefined(fields["message"]))
	}
	commit := Commit{Message: message}
	if raw, present := fields["paths"]; present {
		paths, ok := decodeStrings(raw)
		if !ok {
			return Commit{}, fmt.Errorf("%s: invalid commit paths: expected an array of strings, actual %s", scenarioName, compact(raw))
		}
		commit.Paths = paths
	}
	return commit, nil
}

func parseWorktree(scenarioName string, raw json.RawMessage) (Worktree, error) {
	fields, keys, ok := decodeObject(raw)
	if !ok {
		return Worktree{}, fmt.Errorf("%s: invalid worktree: expected an object, actual %s", scenarioName, compact(raw))
	}
	if err := assertKeys(scenarioName, "worktree", keys, worktreeKeys); err != nil {
		return Worktree{}, err
	}
	name, nameOK := decodeString(fields["name"])
	branch, branchOK := decodeString(fields["branch"])
	if !nameOK || !branchOK {
		return Worktree{}, fmt.Errorf("%s: invalid worktree: expected name and branch strings, actual %s", scenarioName, compact(raw))
	}
	return Worktree{Name: name, Branch: branch}, nil
}

func parseGitUser(scenarioName string, raw json.RawMessage) (GitUser, error) {
	fields, keys, ok := decodeObject(raw)
	if !ok {
		return GitUser{}, fmt.Errorf("%s: invalid gitUser: expected an object, actual %s", scenarioName, compact(raw))
	}
	if err := assertKeys(scenarioName, "gitUser", keys, gitUserKeys); err != nil {
		return GitUser{}, err
	}
	name, nameOK := decodeString(fields["name"])
	email, emailOK := decodeString(fields["email"])
	if !nameOK || !emailOK {
		return GitUser{}, fmt.Errorf("%s: invalid gitUser: expected name and email strings, actual %s", scenarioName, compact(raw))
	}
	return GitUser{Name: name, Email: email}, nil
}

func parseSteps(scenarioName string, raw json.RawMessage) ([]Step, error) {
	items, ok := decodeArray(raw)
	if !ok || len(items) == 0 {
		return nil, fmt.Errorf("%s: invalid scenario steps: expected a non-empty array, actual %s", scenarioName, compactOrUndefined(raw))
	}
	steps := []Step{}
	for _, item := range items {
		fields, keys, ok := decodeObject(item)
		if !ok {
			return nil, fmt.Errorf("%s: invalid step: expected an object, actual %s", scenarioName, compact(item))
		}
		if err := assertKeys(scenarioName, "step", keys, stepKeys); err != nil {
			return nil, err
		}
		arguments, ok := decodeStrings(fields["arguments"])
		if !ok {
			return nil, fmt.Errorf("%s: invalid step arguments: expected an array of strings, actual %s", scenarioName, compactOrUndefined(fields["arguments"]))
		}
		step := Step{Arguments: arguments}
		for _, optional := range []struct {
			key         string
			destination **string
		}{
			{key: "stdin", destination: &step.Stdin},
			{key: "now", destination: &step.Now},
			{key: "workingDirectory", destination: &step.WorkingDirectory},
		} {
			raw, present := fields[optional.key]
			if !present {
				continue
			}
			value, ok := decodeString(raw)
			if !ok {
				return nil, fmt.Errorf("%s: invalid %s: expected a string, actual %s", scenarioName, optional.key, compact(raw))
			}
			*optional.destination = &value
		}
		if raw, present := fields["environment"]; present {
			environment, err := parseEnvironment(scenarioName, raw)
			if err != nil {
				return nil, err
			}
			step.Environment = environment
		}
		steps = append(steps, step)
	}
	return steps, nil
}

func parseEnvironment(scenarioName string, raw json.RawMessage) (map[string]string, error) {
	fields, keys, ok := decodeObject(raw)
	if !ok {
		return nil, fmt.Errorf("%s: invalid environment: expected an object, actual %s", scenarioName, compact(raw))
	}
	environment := map[string]string{}
	for _, key := range keys {
		value, ok := decodeString(fields[key])
		if !ok {
			return nil, fmt.Errorf("%s: invalid environment %s: expected a string, actual %s", scenarioName, key, compact(fields[key]))
		}
		environment[key] = value
	}
	return environment, nil
}

// 知らないキーは、書かれた順で最初のものを出す
func assertKeys(scenarioName string, label string, keys []string, allowed []string) error {
	for _, key := range keys {
		known := false
		for _, candidate := range allowed {
			if candidate == key {
				known = true
			}
		}
		if known {
			continue
		}
		name := "unknown key"
		if label != "" {
			name = "unknown " + label + " key"
		}
		return fmt.Errorf("%s: %s: expected one of %s, actual %s", scenarioName, name, strings.Join(allowed, ", "), key)
	}
	return nil
}

// decodeObject は JSON のオブジェクトだけを受ける。キーは書かれた順でも返す
func decodeObject(raw json.RawMessage) (map[string]json.RawMessage, []string, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, nil, false
	}
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(trimmed, &fields); err != nil {
		return nil, nil, false
	}
	return fields, orderedKeys(trimmed), true
}

func decodeArray(raw json.RawMessage) ([]json.RawMessage, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return nil, false
	}
	items := []json.RawMessage{}
	if err := json.Unmarshal(trimmed, &items); err != nil {
		return nil, false
	}
	return items, true
}

func decodeString(raw json.RawMessage) (string, bool) {
	if !isString(raw) {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

func decodeStrings(raw json.RawMessage) ([]string, bool) {
	items, ok := decodeArray(raw)
	if !ok {
		return nil, false
	}
	values := []string{}
	for _, item := range items {
		value, ok := decodeString(item)
		if !ok {
			return nil, false
		}
		values = append(values, value)
	}
	return values, true
}

//declscope:package
func isString(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '"'
}

// orderedKeys はオブジェクトのキーを書かれた順に返す
func orderedKeys(raw json.RawMessage) []string {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return nil
	}
	keys := []string{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return keys
		}
		key, ok := token.(string)
		if !ok {
			return keys
		}
		keys = append(keys, key)
		var skipped json.RawMessage
		if err := decoder.Decode(&skipped); err != nil {
			return keys
		}
	}
	return keys
}

// compact はエラーに出す値を、改行と余白を詰めた JSON にする
func compact(raw json.RawMessage) string {
	var buffer bytes.Buffer
	if err := json.Compact(&buffer, raw); err != nil {
		return string(raw)
	}
	return buffer.String()
}

// 項目が無いときは、JSON.stringify(undefined) の結果と同じ undefined と出す
func compactOrUndefined(raw json.RawMessage) string {
	if raw == nil {
		return "undefined"
	}
	return compact(raw)
}

//declscope:package
func quote(value string) string {
	return string(encodeString(value))
}
