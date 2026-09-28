package golden

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestNormalizeTextReplacesTemporaryDirectoriesLongestFirst(t *testing.T) {
	root := t.TempDir()
	workspaceDirectory := filepath.Join(root, "workspace")
	stateDirectory := filepath.Join(root, "state")
	worktreeDirectory := filepath.Join(workspaceDirectory, "nested")
	repositoryDirectory := filepath.Join(root, "repository")
	for _, directory := range []string{worktreeDirectory, stateDirectory, repositoryDirectory} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	text := strings.Join([]string{
		workspaceDirectory,
		"/private" + workspaceDirectory,
		stateDirectory,
		worktreeDirectory,
		workspaceDirectory + "/.yaru/issues/1.md",
		repositoryDirectory + "/src/web.tsx",
	}, "\n")
	normalized := NormalizeText(text, Bindings{
		WorkspaceDirectory:  workspaceDirectory,
		StateDirectory:      stateDirectory,
		Worktrees:           []WorktreeBinding{{Name: "nested", Directory: worktreeDirectory}},
		RepositoryDirectory: repositoryDirectory,
	})
	expected := strings.Join([]string{
		"<WORKSPACE>",
		"<WORKSPACE>",
		"<STATE>",
		"<WORKTREE:nested>",
		"<WORKSPACE>/.yaru/issues/1.md",
		"<REPOSITORY>/src/web.tsx",
	}, "\n")
	if normalized != expected {
		t.Fatalf("normalized = %q, want %q", normalized, expected)
	}
}

func TestCompareNamesScenarioStepAndField(t *testing.T) {
	expected := Snapshot{
		Name: "issue-create",
		Steps: []RecordedStep{{
			Arguments: []string{"issue", "get", "1"},
			Stdout:    "{\n  \"id\": \"1\"\n}\n",
		}},
		Yaru:  []RecordedFile{{Path: "issues/1.md", Content: "title: gate\n"}},
		State: []RecordedFile{{Path: "workspaces.json", Content: "{}\n"}},
	}
	actual := Snapshot{
		Name: "issue-create",
		Steps: []RecordedStep{{
			Arguments: []string{"issue", "get", "1"},
			Stdout:    "{\n  \"id\": \"2\"\n}\n",
			Stderr:    "issue not found: 1\n",
			ExitCode:  1,
		}},
		Yaru:  []RecordedFile{{Path: "issues/2.md", Content: "title: other\n"}},
		State: []RecordedFile{},
	}
	report := FormatDifferences(Compare(expected, actual))
	for _, want := range []string{
		"scenario issue-create",
		"step 1 (issue get 1)",
		"stdout",
		"stderr",
		"exit code",
		"expected 0, actual 1",
		".yaru/issues/1.md",
		"missing in actual",
		".yaru/issues/2.md",
		"unexpected file",
		"state/workspaces.json",
	} {
		if !strings.Contains(report, want) {
			t.Errorf("report does not contain %q:\n%s", want, report)
		}
	}
	if differences := Compare(expected, expected); len(differences) != 0 {
		t.Fatalf("Compare(expected, expected) = %v, want none", differences)
	}
}

func TestUnifiedDiffKeepsInsertedLineFromShiftingLinesAfterIt(t *testing.T) {
	expected := Snapshot{Name: "issue-create", Steps: []RecordedStep{{Arguments: []string{"issue", "list"}, Stdout: "alpha\nbeta\ngamma\n"}}}
	actual := Snapshot{Name: "issue-create", Steps: []RecordedStep{{Arguments: []string{"issue", "list"}, Stdout: "alpha\ninserted\nbeta\ngamma\n"}}}
	report := FormatDifferences(Compare(expected, actual))
	for _, want := range []string{"@@ -1,3 +1,4 @@", "+inserted"} {
		if !strings.Contains(report, want) {
			t.Errorf("report does not contain %q:\n%s", want, report)
		}
	}
	for _, unwanted := range []string{"-beta", "-gamma"} {
		if strings.Contains(report, unwanted) {
			t.Errorf("report contains %q:\n%s", unwanted, report)
		}
	}
}

func TestTrailingSpaceAndCarriageReturnAreShownAsJSONStrings(t *testing.T) {
	expected := Snapshot{Name: "issue-create", Steps: []RecordedStep{{Arguments: []string{"issue", "get", "1"}, Stdout: "keep\nvalue\n"}}}
	actual := Snapshot{Name: "issue-create", Steps: []RecordedStep{{Arguments: []string{"issue", "get", "1"}, Stdout: "keep\nvalue \r\n"}}}
	report := FormatDifferences(Compare(expected, actual))
	for _, want := range []string{`-"value"`, `+"value \r"`} {
		if !strings.Contains(report, want) {
			t.Errorf("report does not contain %q:\n%s", want, report)
		}
	}
}

func TestCommitHashesBecomeNumberedPlaceholders(t *testing.T) {
	first := strings.Repeat("a", 40)
	second := strings.Repeat("b", 40)
	text := first + "\n" + first[:7] + " " + second[:7] + "\n" + second + "\n"
	normalized := NormalizeText(text, Bindings{
		WorkspaceDirectory: "/workspace",
		StateDirectory:     "/state",
		Commits:            []CommitBinding{{Full: first, Short: first[:7]}, {Full: second, Short: second[:7]}},
	})
	if want := "<COMMIT:1>\n<COMMIT:1> <COMMIT:2>\n<COMMIT:2>\n"; normalized != want {
		t.Fatalf("normalized = %q, want %q", normalized, want)
	}
	unrelated := "aaaaaaa" + strings.Repeat("b", 33)
	kept := NormalizeText(unrelated, Bindings{
		WorkspaceDirectory: "/workspace",
		StateDirectory:     "/state",
		Commits:            []CommitBinding{{Full: first, Short: first[:7]}},
	})
	if kept != unrelated {
		t.Fatalf("normalized = %q, want %q unchanged", kept, unrelated)
	}
}

func TestRunUsesCommandAndLeavesRealStateUntouched(t *testing.T) {
	root := t.TempDir()
	sentinelState := t.TempDir()
	command := writeScript(t, root, strings.Join([]string{
		"#!/bin/sh",
		"printf 'marker:fake-yaru\\n'",
		"printf 'args:%s\\n' \"$*\"",
		"printf 'now:%s\\n' \"${YARU_NOW-}\"",
		"printf 'state:%s\\n' \"${YARU_STATE_DIR-}\"",
		"printf 'session:%s\\n' \"${CLAUDE_CODE_SESSION_ID-}\"",
		`mkdir -p "$PWD/.yaru" "$YARU_STATE_DIR"`,
		`printf 'cwd:%s\n' "$PWD" > "$PWD/.yaru/note.txt"`,
		`printf 'state:%s\n' "$YARU_STATE_DIR" > "$YARU_STATE_DIR/marker.txt"`,
		"",
	}, "\n"))
	t.Setenv("YARU_STATE_DIR", sentinelState)
	t.Setenv("YARU_NOW", "1999-01-01T00:00:00.000Z")
	t.Setenv("CLAUDE_CODE_SESSION_ID", "session-should-not-leak")
	snapshot, err := runnerFor(t, command).Run(Scenario{
		Name:        "fake-bin",
		Description: "a stand-in CLI",
		Steps: []Step{
			{Arguments: []string{"init"}, Now: pointer("2026-09-28T12:00:00.000Z")},
			{
				Arguments:   []string{"issue", "list"},
				Environment: map[string]string{"CLAUDE_CODE_SESSION_ID": "scenario-session"},
				Now:         pointer("2026-09-28T13:00:00.000Z"),
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	first := snapshot.Steps[0].Stdout
	for _, want := range []string{"marker:fake-yaru", "args:init", "now:2026-09-28T12:00:00.000Z", "state:<STATE>"} {
		if !strings.Contains(first, want) {
			t.Errorf("step 1 stdout does not contain %q:\n%s", want, first)
		}
	}
	for _, unwanted := range []string{"session-should-not-leak", "1999-01-01"} {
		if strings.Contains(first, unwanted) {
			t.Errorf("step 1 stdout contains %q:\n%s", unwanted, first)
		}
	}
	second := snapshot.Steps[1].Stdout
	for _, want := range []string{"session:scenario-session", "now:2026-09-28T13:00:00.000Z"} {
		if !strings.Contains(second, want) {
			t.Errorf("step 2 stdout does not contain %q:\n%s", want, second)
		}
	}
	assertFiles(t, "yaru", snapshot.Yaru, []RecordedFile{{Path: "note.txt", Content: "cwd:<WORKSPACE>\n"}})
	assertFiles(t, "state", snapshot.State, []RecordedFile{{Path: "marker.txt", Content: "state:<STATE>\n"}})
	encoded := string(EncodeSnapshot(snapshot))
	for _, unwanted := range []string{"yaru-golden-", sentinelState} {
		if strings.Contains(encoded, unwanted) {
			t.Errorf("snapshot contains %q:\n%s", unwanted, encoded)
		}
	}
	entries, err := os.ReadDir(sentinelState)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("sentinel state has %d entries, want 0", len(entries))
	}
}

func TestCheckNamesScenarioStepAndStream(t *testing.T) {
	root := t.TempDir()
	command := writeScript(t, root, "#!/bin/sh\nprintf 'actual\\n'\n")
	snapshotPath := filepath.Join(root, "issue-create.json")
	writeFile(t, snapshotPath, `{"name":"issue-create","steps":[{"arguments":["init"],"stdout":"expected\n","stderr":"","exitCode":0}],"yaru":[],"state":[]}`)
	expected, err := ReadSnapshot(snapshotPath)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := runnerFor(t, command).Run(Scenario{
		Name:        "issue-create",
		Description: "create an issue",
		Steps:       []Step{{Arguments: []string{"init"}, Now: pointer("2026-09-28T12:00:00.000Z")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	report := FormatDifferences(Compare(expected, actual))
	for _, want := range []string{"scenario issue-create", "step 1 (init)", "stdout", "-expected", "+actual"} {
		if !strings.Contains(report, want) {
			t.Errorf("report does not contain %q:\n%s", want, report)
		}
	}
}

func TestOmittedNowAndTimeZoneUseFixedClockAndAsiaTokyo(t *testing.T) {
	root := t.TempDir()
	command := writeScript(t, root, strings.Join([]string{
		"#!/bin/sh",
		"printf 'now:%s\\n' \"${YARU_NOW-}\"",
		"printf 'tz:%s\\n' \"${TZ-}\"",
		"printf 'home:%s\\n' \"${HOME-}\"",
		"printf 'gitconfig:%s\\n' \"${GIT_CONFIG_GLOBAL-}\"",
		"printf 'gitsystem:%s\\n' \"${GIT_CONFIG_NOSYSTEM-}\"",
		"global_name=$(git config --global user.name || true)",
		"printf 'global-name:%s\\n' \"$global_name\"",
		"printf 'local-name:%s\\n' \"$(git config user.name || true)\"",
		"printf 'stdin:%s\\n' \"$(cat)\"",
		`mkdir -p "$PWD/.yaru/empty"`,
		"",
	}, "\n"))
	t.Setenv("YARU_NOW", "1999-01-01T00:00:00.000Z")
	snapshot, err := runnerFor(t, command).Run(Scenario{
		Name:        "fixed-clock",
		Description: "clock and timezone",
		Steps: []Step{
			{Arguments: []string{"init"}},
			{
				Arguments:        []string{"issue", "list"},
				Environment:      map[string]string{"TZ": "America/Los_Angeles"},
				Stdin:            pointer("note\n"),
				WorkingDirectory: pointer("."),
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	first := snapshot.Steps[0].Stdout
	for _, want := range []string{
		"now:2026-09-28T00:00:00.000Z",
		"tz:Asia/Tokyo",
		"home:<HOME>",
		"gitconfig:/dev/null",
		"gitsystem:1",
		"global-name:\n",
		"local-name:golden",
	} {
		if !strings.Contains(first, want) {
			t.Errorf("step 1 stdout does not contain %q:\n%s", want, first)
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(first, home) {
		t.Errorf("step 1 stdout contains the real home %q:\n%s", home, first)
	}
	second := snapshot.Steps[1]
	for _, want := range []string{"tz:America/Los_Angeles", "stdin:note"} {
		if !strings.Contains(second.Stdout, want) {
			t.Errorf("step 2 stdout does not contain %q:\n%s", want, second.Stdout)
		}
	}
	if second.Stdin != "note\n" || second.Now != "2026-09-28T00:00:00.000Z" || second.WorkingDirectory != "." {
		t.Errorf("step 2 inputs = stdin %q, now %q, workingDirectory %q", second.Stdin, second.Now, second.WorkingDirectory)
	}
	if len(second.Environment) != 1 || second.Environment["TZ"] != "America/Los_Angeles" {
		t.Errorf("step 2 environment = %v, want only TZ America/Los_Angeles", second.Environment)
	}
	found := false
	for _, file := range snapshot.Yaru {
		if file == (RecordedFile{Path: "empty", Content: "", Directory: true}) {
			found = true
		}
	}
	if !found {
		t.Errorf("yaru = %v, want an empty directory entry", snapshot.Yaru)
	}
}

func TestPathLeavingWorkspaceIsRejected(t *testing.T) {
	name := "yaru-golden-outside-" + filepath.Base(t.TempDir()) + ".txt"
	outside := filepath.Join(os.TempDir(), name)
	_, err := runnerFor(t, "/bin/true").Run(Scenario{
		Name:        "escape",
		Description: "path traversal",
		Setup:       &Setup{Files: []File{{Path: filepath.Join("..", "..", name), Content: "no\n"}}},
		Steps:       []Step{{Arguments: []string{"init"}}},
	})
	assertError(t, err, `invalid path: expected a path inside the workspace`)
	if _, statErr := os.Stat(outside); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("%s exists, want it not written", outside)
	}
}

func TestStepCannotSetStateDirectory(t *testing.T) {
	_, err := runnerFor(t, "/bin/true").Run(Scenario{
		Name:        "state-dir",
		Description: "reject state override",
		Steps:       []Step{{Arguments: []string{"init"}, Environment: map[string]string{"YARU_STATE_DIR": "/tmp/yaru-not-the-temp"}}},
	})
	assertError(t, err, `YARU_STATE_DIR`)
}

func TestUnknownScenarioKeyIsRejectedWithScenarioName(t *testing.T) {
	directory := t.TempDir()
	writeFile(t, filepath.Join(directory, "issue-create.json"), `{"name":"issue-create","description":"create","extra":true,"steps":[{"arguments":["init"]}]}`)
	_, err := LoadScenarios(directory)
	assertError(t, err, `^issue-create: unknown key: expected one of name, description, setup, steps, actual extra$`)
}

func TestUnknownSetupKeyIsRejected(t *testing.T) {
	directory := t.TempDir()
	writeFile(t, filepath.Join(directory, "issue-create.json"), `{"name":"issue-create","description":"create","setup":{"extra":true},"steps":[{"arguments":["init"]}]}`)
	_, err := LoadScenarios(directory)
	assertError(t, err, `^issue-create: unknown setup key: expected one of files, commits, worktrees, gitUser, actual extra$`)
}

func TestScenarioNameMustMatchFileName(t *testing.T) {
	directory := t.TempDir()
	writeFile(t, filepath.Join(directory, "issue-create.json"), `{"name":"other","description":"create","steps":[{"arguments":["init"]}]}`)
	_, err := LoadScenarios(directory)
	assertError(t, err, `^invalid scenario name: expected issue-create, actual "other"$`)
}

func TestMissingWorkingDirectoryNamesScenario(t *testing.T) {
	_, err := runnerFor(t, "/bin/true").Run(Scenario{
		Name:        "missing-dir",
		Description: "missing working directory",
		Steps:       []Step{{Arguments: []string{"init"}, WorkingDirectory: pointer("no/such")}},
	})
	assertError(t, err, `^missing-dir: workingDirectory not found: expected .*no/such, actual missing$`)
}

func TestExtraSnapshotIsReported(t *testing.T) {
	directory := t.TempDir()
	writeFile(t, filepath.Join(directory, "issue-create.json"), "{}\n")
	writeFile(t, filepath.Join(directory, "leftover.json"), "{}\n")
	differences, err := UnexpectedSnapshots([]Scenario{{Name: "issue-create"}}, directory)
	if err != nil {
		t.Fatal(err)
	}
	report := FormatDifferences(differences)
	for _, want := range []string{"scenario leftover", "unexpected snapshot: expected no file, actual leftover.json"} {
		if !strings.Contains(report, want) {
			t.Errorf("report does not contain %q:\n%s", want, report)
		}
	}
	if strings.Contains(report, "issue-create") {
		t.Errorf("report names issue-create:\n%s", report)
	}
}

func TestWorktreeNameMustBeLowercaseWords(t *testing.T) {
	_, err := runnerFor(t, "/bin/true").Run(Scenario{
		Name:        "bad-worktree",
		Description: "bad worktree name",
		Setup: &Setup{
			Files:     []File{{Path: "README.md", Content: "a\n"}},
			Commits:   []Commit{{Message: "initial", Paths: []string{"README.md"}}},
			Worktrees: []Worktree{{Name: "Feature", Branch: "feat/x"}},
		},
		Steps: []Step{{Arguments: []string{"init"}}},
	})
	assertError(t, err, `invalid worktree name`)
}

func TestMainWorktreeIsRefused(t *testing.T) {
	if _, err := os.Stat(mainWorktree); err != nil {
		t.Skipf("main worktree %s is not on this machine", mainWorktree)
	}
	// リポジトリの検査に先に当たらないよう、リポジトリは別の場所として渡す
	assertError(t, AssertIsolated(mainWorktree, t.TempDir()), `main worktree`)
	if err := AssertIsolated(t.TempDir(), repositoryRoot(t)); err != nil {
		t.Fatal(err)
	}
}

// 記録は TS 版の JSON.stringify(snapshot, null, 2) と同じバイトで書く
// https://tc39.es/ecma262/#sec-quotejsonstring
func TestEncodeSnapshotMatchesJSONStringify(t *testing.T) {
	snapshot := Snapshot{
		Name: "encode",
		Steps: []RecordedStep{{
			Arguments:        []string{},
			Environment:      map[string]string{"TZ": "Asia/Tokyo", "A": "<&>"},
			Now:              "2026-09-28T00:00:00.000Z",
			WorkingDirectory: ".",
			Stdout:           "<WORKSPACE>\x00\x01\b\f\n\r\t\"\\\u2028\u00e9\x7f",
			ExitCode:         1,
		}},
		Yaru:  []RecordedFile{{Path: "empty", Directory: true}, {Path: "a.md", Content: "x"}},
		State: []RecordedFile{},
	}
	want := `{
  "name": "encode",
  "steps": [
    {
      "arguments": [],
      "stdin": "",
      "environment": {
        "A": "<&>",
        "TZ": "Asia/Tokyo"
      },
      "now": "2026-09-28T00:00:00.000Z",
      "workingDirectory": ".",
      "stdout": "<WORKSPACE>\u0000\u0001\b\f\n\r\t\"\\` + "\u2028\u00e9\x7f" + `",
      "stderr": "",
      "exitCode": 1
    }
  ],
  "yaru": [
    {
      "path": "empty",
      "content": "",
      "directory": true
    },
    {
      "path": "a.md",
      "content": "x"
    }
  ],
  "state": []
}
`
	if got := string(EncodeSnapshot(snapshot)); got != want {
		t.Fatalf("EncodeSnapshot =\n%s\nwant\n%s", got, want)
	}
}

// 子プロセスの出力とファイルは TextDecoder と同じく、壊れた並びを 1 つの U+FFFD にしてから記録する
// https://encoding.spec.whatwg.org/#utf-8-decoder
func TestDecodeUTF8ReplacesMaximalSubparts(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{input: "plain é", want: "plain é"},
		{input: "\xe3\x81a", want: "\ufffda"},
		{input: "\xff\xfe", want: "\ufffd\ufffd"},
		{input: "\xf0\x9f\x98", want: "\ufffd"},
		{input: "\xed\xa0\x80", want: "\ufffd\ufffd\ufffd"},
		{input: "\xc0\xaf", want: "\ufffd\ufffd"},
	}
	for _, testCase := range cases {
		if got := decodeUTF8([]byte(testCase.input)); got != testCase.want {
			t.Errorf("decodeUTF8(%q) = %q, want %q", testCase.input, got, testCase.want)
		}
	}
}

func runnerFor(t *testing.T, command string) Runner {
	t.Helper()
	return Runner{Command: command, RepositoryDirectory: repositoryRoot(t)}
}

//declscope:package
func repositoryRoot(t *testing.T) string {
	t.Helper()
	directory, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return directory
}

func writeScript(t *testing.T, directory string, content string) string {
	t.Helper()
	path := filepath.Join(directory, "fake-yaru.sh")
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func assertFiles(t *testing.T, label string, actual []RecordedFile, expected []RecordedFile) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("%s = %v, want %v", label, actual, expected)
	}
	for index := range expected {
		if actual[index] != expected[index] {
			t.Fatalf("%s = %v, want %v", label, actual, expected)
		}
	}
}

func assertError(t *testing.T, err error, pattern string) {
	t.Helper()
	if err == nil {
		t.Fatalf("error = nil, want one matching %q", pattern)
	}
	if !regexp.MustCompile(pattern).MatchString(err.Error()) {
		t.Fatalf("error = %q, want one matching %q", err.Error(), pattern)
	}
}

func pointer(value string) *string {
	return &value
}
