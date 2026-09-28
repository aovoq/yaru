package repository_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aovoq/yaru/internal/errs"
	"github.com/aovoq/yaru/internal/repository"
)

func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "yaru-repository-home-")
	if err != nil {
		panic(err)
	}
	_ = os.MkdirAll(filepath.Join(home, "state"), 0o755)
	_ = os.Setenv("HOME", home)
	_ = os.Setenv("YARU_STATE_DIR", filepath.Join(home, "state"))
	_ = os.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	_ = os.Setenv("TZ", "Asia/Tokyo")
	_ = os.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	_ = os.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	_ = os.Setenv("GIT_AUTHOR_NAME", "tester")
	_ = os.Setenv("GIT_AUTHOR_EMAIL", "t@example.com")
	_ = os.Setenv("GIT_COMMITTER_NAME", "tester")
	_ = os.Setenv("GIT_COMMITTER_EMAIL", "t@example.com")
	code := m.Run()
	_ = os.RemoveAll(home)
	os.Exit(code)
}

func git(t *testing.T, directory string, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	command.Env = os.Environ()
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
	return string(output)
}

func commitAt(t *testing.T, directory string, file string, subject string, date string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(directory, file), []byte(subject), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, directory, "add", file)
	command := exec.Command("git", "-c", "user.name=tester", "-c", "user.email=t@example.com", "commit", "-q", "--date", date, "-m", subject)
	command.Dir = directory
	command.Env = append(os.Environ(), "GIT_COMMITTER_DATE="+date)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("commit %s: %v\n%s", subject, err, output)
	}
}

func commitAtMinute(t *testing.T, directory string, file string, subject string, minute int) {
	t.Helper()
	date := "2026-09-20T00:" + twoDigits(minute) + ":00Z"
	commitAt(t, directory, file, subject, date)
}

func twoDigits(value int) string {
	if value < 10 {
		return "0" + string(rune('0'+value))
	}
	return string(rune('0'+value/10)) + string(rune('0'+value%10))
}

func initRepo(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	git(t, directory, "init", "-q", "-b", "main")
	return directory
}

func subjects(commits []repository.Commit) []string {
	names := make([]string, 0, len(commits))
	for _, commit := range commits {
		names = append(names, commit.Subject)
	}
	return names
}

func equalStrings(t *testing.T, got []string, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %q want %q", got, want)
	}
	for index := range got {
		if got[index] != want[index] {
			t.Fatalf("got %q want %q", got, want)
		}
	}
}

func TestReadRepositoryStateOutsideGit(t *testing.T) {
	state, err := repository.ReadRepositoryState(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if state != nil {
		t.Fatalf("got %#v", state)
	}
}

func TestReadRepositoryStateBareRepository(t *testing.T) {
	directory := t.TempDir()
	git(t, directory, "init", "-q", "--bare", "-b", "main")
	state, err := repository.ReadRepositoryState(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	if state != nil {
		t.Fatalf("got %#v", state)
	}
}

func TestReadRepositoryStateMissingDirectoryAndFile(t *testing.T) {
	_, err := repository.ReadRepositoryState(context.Background(), filepath.Join(t.TempDir(), "missing"))
	if err == nil || err.Error() != "ENOENT: no such file or directory, posix_spawn 'git'" {
		t.Fatalf("got %v", err)
	}
	file := filepath.Join(t.TempDir(), "file")
	if writeErr := os.WriteFile(file, []byte("x"), 0o644); writeErr != nil {
		t.Fatal(writeErr)
	}
	_, err = repository.ReadRepositoryState(context.Background(), file)
	if err == nil || err.Error() != "ENOTDIR: not a directory, posix_spawn 'git'" {
		t.Fatalf("got %v", err)
	}
}

func TestReadRepositoryStatePermissionDenied(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "blocked")
	if err := os.Mkdir(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(directory, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(directory, 0o755) })
	_, err := repository.ReadRepositoryState(context.Background(), directory)
	if err == nil || err.Error() != "EACCES: permission denied, posix_spawn 'git'" {
		t.Fatalf("got %v", err)
	}
}

func TestReadRepositoryStateWithoutUpstream(t *testing.T) {
	directory := initRepo(t)
	commitAtMinute(t, directory, "a.txt", "最初のコミット", 0)
	commitAtMinute(t, directory, "b.txt", "二つ目", 1)
	if err := os.WriteFile(filepath.Join(directory, "dirty.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	state, err := repository.ReadRepositoryState(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	if state.Branch == nil || *state.Branch != "main" {
		t.Fatalf("branch %#v", state.Branch)
	}
	if state.Upstream != nil || state.Ahead != nil || state.Behind != nil {
		t.Fatalf("upstream %#v ahead %#v behind %#v", state.Upstream, state.Ahead, state.Behind)
	}
	if state.UncommittedFiles != 1 {
		t.Fatalf("uncommitted %d", state.UncommittedFiles)
	}
	equalStrings(t, subjects(state.Commits), []string{"二つ目", "最初のコミット"})
	if state.Commits[0].Author != "tester" || state.Commits[0].CommittedAt != "2026-09-20T00:01:00Z" || state.Commits[0].Pushed != nil {
		t.Fatalf("%#v", state.Commits[0])
	}
	shortHash := strings.TrimSpace(git(t, directory, "log", "-1", "--format=%h"))
	if state.Commits[0].Hash != shortHash {
		t.Fatalf("hash %s want %s", state.Commits[0].Hash, shortHash)
	}
}

func TestReadRepositoryStateDetachedAndEmpty(t *testing.T) {
	empty := initRepo(t)
	state, err := repository.ReadRepositoryState(context.Background(), empty)
	if err != nil {
		t.Fatal(err)
	}
	if state.Branch == nil || *state.Branch != "main" || len(state.Commits) != 0 || state.UncommittedFiles != 0 {
		t.Fatalf("%#v", state)
	}

	detached := initRepo(t)
	commitAtMinute(t, detached, "a.txt", "only", 0)
	git(t, detached, "checkout", "-q", "--detach")
	state, err = repository.ReadRepositoryState(context.Background(), detached)
	if err != nil {
		t.Fatal(err)
	}
	if state.Branch != nil || state.Commits[0].Pushed != nil || state.Commits[0].Subject != "only" {
		t.Fatalf("%#v", state)
	}
}

func TestReadRepositoryStateAheadAndUncommittedLines(t *testing.T) {
	remote := t.TempDir()
	git(t, remote, "init", "-q", "--bare", "-b", "main")
	directory := initRepo(t)
	git(t, directory, "remote", "add", "origin", remote)
	commitAtMinute(t, directory, "a.txt", "一覧を直す #1", 0)
	git(t, directory, "push", "-q", "-u", "origin", "main")
	commitAtMinute(t, directory, "b.txt", "まだ送っていない #1", 1)
	if err := os.WriteFile(filepath.Join(directory, "staged.txt"), []byte("s"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, directory, "add", "staged.txt")
	if err := os.WriteFile(filepath.Join(directory, "staged.txt"), []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "untracked.txt"), []byte("u"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(directory, "untracked-dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "untracked-dir", "one.txt"), []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ".gitignore"), []byte("ignored.txt\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "ignored.txt"), []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	state, err := repository.ReadRepositoryState(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	if state.Upstream == nil || *state.Upstream != "origin/main" || state.Ahead == nil || *state.Ahead != 1 || state.Behind == nil || *state.Behind != 0 {
		t.Fatalf("upstream %#v ahead %#v behind %#v", state.Upstream, state.Ahead, state.Behind)
	}
	if state.UncommittedFiles != 4 {
		t.Fatalf("uncommitted %d", state.UncommittedFiles)
	}
	if state.Commits[0].Pushed == nil || *state.Commits[0].Pushed || state.Commits[1].Pushed == nil || !*state.Commits[1].Pushed {
		t.Fatalf("%#v", state.Commits)
	}
}

func TestReadRepositoryStateRecentCommitLimit(t *testing.T) {
	directory := initRepo(t)
	for minute := 0; minute < 12; minute++ {
		commitAtMinute(t, directory, twoDigits(minute)+".txt", "step "+twoDigits(minute), minute)
	}
	state, err := repository.ReadRepositoryState(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Commits) != repository.RecentCommitsLimit {
		t.Fatalf("len %d", len(state.Commits))
	}
	if state.Commits[0].Subject != "step 11" || state.Commits[9].Subject != "step 02" {
		t.Fatalf("%q", subjects(state.Commits))
	}
}

func TestCommitsForIssueMentionsAndBranch(t *testing.T) {
	directory := initRepo(t)
	commitAtMinute(t, directory, "a.txt", "土台を作る", 0)
	commitAtMinute(t, directory, "b.txt", "一覧を直す #1", 1)
	commitAtMinute(t, directory, "c.txt", "別の件 #12", 2)
	commitAtMinute(t, directory, "d.txt", "関係ない", 3)
	git(t, directory, "switch", "-q", "-c", "feature/x")
	commitAtMinute(t, directory, "e.txt", "途中まで", 4)
	commitAtMinute(t, directory, "f.txt", "続き (#1)", 5)
	git(t, directory, "switch", "-q", "main")

	branch := "feature/x"
	commits, err := repository.CommitsForIssue(context.Background(), directory, "1", &branch)
	if err != nil {
		t.Fatal(err)
	}
	equalStrings(t, subjects(commits), []string{"続き (#1)", "途中まで", "一覧を直す #1"})
	if commits[0].Author != "tester" || commits[0].CommittedAt != "2026-09-20T00:05:00Z" || commits[0].Pushed != nil {
		t.Fatalf("%#v", commits[0])
	}
	mention, err := repository.CommitsForIssue(context.Background(), directory, "1", nil)
	if err != nil {
		t.Fatal(err)
	}
	equalStrings(t, subjects(mention), []string{"続き (#1)", "一覧を直す #1"})
	twelve, err := repository.CommitsForIssue(context.Background(), directory, "12", nil)
	if err != nil {
		t.Fatal(err)
	}
	equalStrings(t, subjects(twelve), []string{"別の件 #12"})
	empty := ""
	same, err := repository.CommitsForIssue(context.Background(), directory, "1", &empty)
	if err != nil {
		t.Fatal(err)
	}
	equalStrings(t, subjects(same), []string{"続き (#1)", "一覧を直す #1"})
	for _, name := range []string{"deleted/branch", "--all", "main..feature/x", "main"} {
		name := name
		got, gotErr := repository.CommitsForIssue(context.Background(), directory, "12", &name)
		if gotErr != nil {
			t.Fatal(gotErr)
		}
		equalStrings(t, subjects(got), []string{"別の件 #12"})
	}
}

func TestCommitsForIssuePushState(t *testing.T) {
	remote := t.TempDir()
	git(t, remote, "init", "-q", "--bare", "-b", "main")
	directory := initRepo(t)
	git(t, directory, "remote", "add", "origin", remote)
	commitAtMinute(t, directory, "a.txt", "一覧を直す #1", 0)
	git(t, directory, "push", "-q", "-u", "origin", "main")
	commitAtMinute(t, directory, "b.txt", "まだ送っていない #1", 1)
	git(t, directory, "switch", "-q", "-c", "feature/x")
	commitAtMinute(t, directory, "c.txt", "ブランチの途中", 2)
	git(t, directory, "switch", "-q", "main")
	branch := "feature/x"
	commits, err := repository.CommitsForIssue(context.Background(), directory, "1", &branch)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		subject string
		pushed  bool
	}{
		{"ブランチの途中", false},
		{"まだ送っていない #1", false},
		{"一覧を直す #1", true},
	}
	if len(commits) != len(want) {
		t.Fatalf("%q", subjects(commits))
	}
	for index, row := range want {
		if commits[index].Subject != row.subject || commits[index].Pushed == nil || *commits[index].Pushed != row.pushed {
			t.Fatalf("%#v", commits[index])
		}
	}
}

func TestCommitsForIssuePatternsBodyTieOffsetSeparatorAndLimits(t *testing.T) {
	patterns := initRepo(t)
	for index, subject := range []string{"end #7", "twelve #78", "paren (#7)", "dot #7.", "word prefix#7", "letter #7a", "fullwidth ＃7", "space # 7", "double ##7"} {
		commitAtMinute(t, patterns, twoDigits(index)+".txt", subject, index)
	}
	got, err := repository.CommitsForIssue(context.Background(), patterns, "7", nil)
	if err != nil {
		t.Fatal(err)
	}
	equalStrings(t, subjects(got), []string{"double ##7", "letter #7a", "word prefix#7", "dot #7.", "paren (#7)", "end #7"})

	body := initRepo(t)
	commitAt(t, body, "a.txt", "題名だけ\n\n本文に #4 がある", "2026-09-20T00:00:00Z")
	got, err = repository.CommitsForIssue(context.Background(), body, "4", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Subject != "題名だけ" || got[0].CommittedAt != "2026-09-20T00:00:00Z" {
		t.Fatalf("%#v", got)
	}

	tie := initRepo(t)
	commitAt(t, tie, "a.txt", "first #8", "2026-09-20T00:10:00Z")
	commitAt(t, tie, "b.txt", "second #8", "2026-09-20T00:10:00Z")
	got, err = repository.CommitsForIssue(context.Background(), tie, "8", nil)
	if err != nil {
		t.Fatal(err)
	}
	equalStrings(t, subjects(got), []string{"second #8", "first #8"})

	offset := initRepo(t)
	commitAt(t, offset, "a.txt", "later Z #6", "2026-09-20T13:00:00Z")
	commitAt(t, offset, "b.txt", "earlier offset #6", "2026-09-20T21:00:00+09:00")
	got, err = repository.CommitsForIssue(context.Background(), offset, "6", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Subject != "later Z #6" || got[0].CommittedAt != "2026-09-20T13:00:00Z" || got[1].CommittedAt != "2026-09-20T21:00:00+09:00" {
		t.Fatalf("%#v", got)
	}

	separator := "\u001f"
	split := initRepo(t)
	command := exec.Command("git", "-c", "user.name=ann"+separator+"extra", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "--date", "2026-09-20T00:00:00Z", "-m", "sub"+separator+"ject #5")
	command.Dir = split
	command.Env = append(os.Environ(), "GIT_COMMITTER_DATE=2026-09-20T00:00:00Z", "GIT_AUTHOR_NAME=ann"+separator+"extra")
	if output, commitErr := command.CombinedOutput(); commitErr != nil {
		t.Fatalf("%v\n%s", commitErr, output)
	}
	got, err = repository.CommitsForIssue(context.Background(), split, "5", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Subject != "sub" || got[0].Author != "ject #5" || got[0].CommittedAt != "ann" {
		t.Fatalf("%#v", got[0])
	}

	capped := initRepo(t)
	for index := 0; index < 25; index++ {
		commitAtMinute(t, capped, twoDigits(index)+".txt", "step "+itoa(index)+" #3", index)
	}
	got, err = repository.CommitsForIssue(context.Background(), capped, "3", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != repository.IssueCommitsLimit || got[0].Subject != "step 24 #3" || got[19].Subject != "step 5 #3" {
		t.Fatalf("%q", subjects(got))
	}

	mixed := initRepo(t)
	for index := 0; index < 15; index++ {
		commitAtMinute(t, mixed, "m"+twoDigits(index)+".txt", "mentioned "+itoa(index)+" #9", index)
	}
	git(t, mixed, "switch", "-q", "-c", "feature/y")
	for index := 0; index < 15; index++ {
		commitAtMinute(t, mixed, "b"+twoDigits(index)+".txt", "branch "+itoa(index), index+20)
	}
	git(t, mixed, "switch", "-q", "main")
	branch := "feature/y"
	got, err = repository.CommitsForIssue(context.Background(), mixed, "9", &branch)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 20 || got[0].Subject != "branch 14" || got[14].Subject != "branch 0" || got[15].Subject != "mentioned 14 #9" || got[19].Subject != "mentioned 10 #9" {
		t.Fatalf("%q", subjects(got))
	}
}

func TestCommitsForIssueOutsideGitAndInvalidID(t *testing.T) {
	branch := "main"
	commits, err := repository.CommitsForIssue(context.Background(), t.TempDir(), "1", &branch)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 0 {
		t.Fatalf("%#v", commits)
	}
	cases := []struct {
		id   string
		want string
	}{
		{id: "1|2", want: `invalid issue id: expected digits, actual "1|2"`},
		{id: "", want: `invalid issue id: expected digits, actual ""`},
		{id: "1 ", want: `invalid issue id: expected digits, actual "1 "`},
		{id: "1\n2", want: `invalid issue id: expected digits, actual "1\n2"`},
		{id: "say \"hi\"", want: `invalid issue id: expected digits, actual "say \"hi\""`},
		{id: "a\\b", want: `invalid issue id: expected digits, actual "a\\b"`},
		{id: "a\nb", want: `invalid issue id: expected digits, actual "a\nb"`},
		{id: "a\u0000b", want: `invalid issue id: expected digits, actual "a\u0000b"`},
		{id: "a\bb", want: `invalid issue id: expected digits, actual "a\bb"`},
		{id: "a\u0001b", want: `invalid issue id: expected digits, actual "a\u0001b"`},
		{id: "a\u2028b", want: "invalid issue id: expected digits, actual \"a\u2028b\""},
		{id: "a\u2029b", want: "invalid issue id: expected digits, actual \"a\u2029b\""},
		{id: "<&>", want: `invalid issue id: expected digits, actual "<&>"`},
		{id: "１", want: `invalid issue id: expected digits, actual "１"`},
		{id: "1.2", want: `invalid issue id: expected digits, actual "1.2"`},
		{id: "-1", want: `invalid issue id: expected digits, actual "-1"`},
	}
	for _, item := range cases {
		_, gotErr := repository.CommitsForIssue(context.Background(), filepath.Join(t.TempDir(), "missing"), item.id, nil)
		if gotErr == nil || gotErr.Error() != item.want || !errors.Is(gotErr, errs.ErrInvalidArgument) {
			t.Fatalf("id %q got %v", item.id, gotErr)
		}
	}
	for _, id := range []string{"0", "01"} {
		got, gotErr := repository.CommitsForIssue(context.Background(), t.TempDir(), id, nil)
		if gotErr != nil || len(got) != 0 {
			t.Fatalf("id %s got %#v %v", id, got, gotErr)
		}
	}
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := []byte{}
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}
