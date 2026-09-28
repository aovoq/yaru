//declscope:namespace cli

package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

func TestGoldenHelpAndErrors(t *testing.T) {
	// ワークスペースを開かずに終わる場面。正解は spec/golden の記録
	names := []string{
		"gs-init-dash-help-word",
		"gs-init-double-dash-only",
		"gs-init-double-dash-stops-flags",
		"gs-init-empty-flag-value",
		"gs-init-flag-equals-missing",
		"gs-init-flag-equals-unknown",
		"gs-init-format-rejects-value",
		"gs-init-format-without-command",
		"gs-init-help-before-command",
		"gs-init-help-blocked-by-missing-value",
		"gs-init-help-blocked-on-init",
		"gs-init-help-dispatch",
		"gs-init-help-long",
		"gs-init-help-on-init",
		"gs-init-help-on-serve",
		"gs-init-help-short-before-command",
		"gs-init-help-short-on-init",
		"gs-init-help-short",
		"gs-init-help-wins-over-format",
		"gs-init-help-word-rest",
		"gs-init-help-word",
		"gs-init-invalid-now",
		"gs-init-invalid-now-date-only",
		"gs-init-invalid-now-empty",
		"gs-init-invalid-now-feb30",
		"gs-init-invalid-now-hour",
		"gs-init-invalid-now-lowercase",
		"gs-init-invalid-now-month",
		"gs-init-invalid-now-on-help",
		"gs-init-missing-flag-value",
		"gs-init-missing-flag-value-next-flag",
		"gs-init-missing-flag-value-next-short",
		"gs-init-missing-id",
		"gs-init-missing-required-flag",
		"gs-init-no-args",
		"gs-init-rejects-force",
		"gs-init-rejects-format",
		"gs-init-rejects-short-format",
		"gs-init-short-flag-case",
		"gs-init-subcommand-help-blocked-by-missing-value",
		"gs-init-triple-dash",
		"gs-init-unexpected-argument-before-open",
		"gs-init-unknown-command",
		"gs-init-unknown-command-case",
		"gs-init-unknown-command-ignores-flags",
		"gs-init-unknown-command-with-help",
		"gs-init-unknown-flag-before-command",
		"gs-init-unknown-flag-before-open",
		"gs-init-unknown-flag-long",
		"gs-init-unknown-flag-short",
		"gs-init-unknown-flag-without-command",
		"gs-init-value-that-looks-like-cluster",
	}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			replaySnapshot(t, name)
		})
	}
}

func TestIssueJSONMatchesStringifyIndent(t *testing.T) {
	worktree := "/tmp/workspace"
	branch := "main"
	issue := store.Issue{
		ID: "1", Title: "Fix the gate", Status: "todo", Labels: []string{"cli"},
		Priority: stringPointer("high"), Blocks: []string{}, BlockedBy: []string{}, Children: []string{},
		CreatedAt: "2026-09-28T12:00:00.000Z", UpdatedAt: "2026-09-28T12:00:00.000Z",
		Worktree: &worktree, Branch: &branch, Body: "a<b\u2028c",
	}
	stdout, stderr, code := runCLI(t, []string{"issue", "get", "1"}, "", &services{
		now:              fixedNow,
		workingDirectory: fixedDirectory,
		open:             fixedOpen,
		register:         noopRegister,
		getIssue: func(workspace.Workspace, string) (store.Issue, error) {
			return issue, nil
		},
	})
	if code != 0 || stderr != "" {
		t.Fatalf("code %d stderr %q", code, stderr)
	}
	if !strings.Contains(stdout, "\"body\": \"a<b\u2028c\"") {
		t.Fatalf("stdout = %q, want raw < and U+2028", stdout)
	}
	if strings.Contains(stdout, `\u003c`) || strings.Contains(stdout, `\u2028`) {
		t.Fatalf("stdout escaped a character JSON.stringify leaves raw: %q", stdout)
	}
	if !strings.HasPrefix(stdout, "{\n  \"id\": \"1\"") || !strings.HasSuffix(stdout, "\n") {
		t.Fatalf("stdout = %q, want indented JSON", stdout)
	}
}

func TestHumanFormats(t *testing.T) {
	issue := store.Issue{
		ID: "1", Title: "Fix the gate", Status: "todo", Labels: []string{"cli"},
		Priority: stringPointer("high"), Blocks: []string{}, BlockedBy: []string{}, Children: []string{},
		Body: "The latch sticks.",
	}
	stdout, _, code := runCLI(t, []string{"issue", "get", "1", "-f"}, "", &services{
		now: fixedNow, workingDirectory: fixedDirectory, open: fixedOpen, register: noopRegister,
		getIssue: func(workspace.Workspace, string) (store.Issue, error) { return issue, nil },
	})
	if code != 0 {
		t.Fatal(code)
	}
	const wantIssue = "1  todo  -  cli  -  high  parent -  blocks -  blockedBy -\nFix the gate\n\nThe latch sticks.\n"
	if stdout != wantIssue {
		t.Fatalf("stdout = %q, want %q", stdout, wantIssue)
	}

	listOut, _, code := runCLI(t, []string{"issue", "list", "--format"}, "", &services{
		now: fixedNow, workingDirectory: fixedDirectory, open: fixedOpen, register: noopRegister,
		listIssues: func(workspace.Workspace, store.Filter) ([]store.Issue, error) {
			return []store.Issue{{ID: "1", Title: "Fix the gate", Status: "todo", Priority: stringPointer("high")}}, nil
		},
		pageIssues: func(issues []store.Issue, limit any, cursor *string) (store.IssuePage, error) {
			return store.IssuePage{Issues: issues, HasNextPage: false}, nil
		},
	})
	if code != 0 {
		t.Fatal(code)
	}
	const wantList = "1  todo          -             -           high    Fix the gate\n"
	if listOut != wantList {
		t.Fatalf("list = %q, want %q", listOut, wantList)
	}
}

func TestQuestionWarningPrecedesJSON(t *testing.T) {
	var notifiedURL string
	stdout, stderr, code := runCLI(t, []string{"question", "save", "--title", "No default"}, "", &services{
		now: fixedNow, workingDirectory: fixedDirectory, open: fixedOpen, register: noopRegister,
		findSlug: func(string) (string, error) { return "a b", nil },
		readProvenance: func(string, []string) (workspace.Provenance, error) {
			return workspace.Provenance{}, nil
		},
		baseURL: func(workspace.Workspace, string) (string, error) {
			return "http://127.0.0.1:47800/", nil
		},
		saveQuestion: func(workspace.Workspace, questions.SaveInput) (questions.Question, error) {
			return questions.Question{ID: "2", Title: "No default", Options: []string{}, Status: "open"}, nil
		},
		notifyQuestionCreated: func(_ workspace.Workspace, url string, _ questions.Question) (string, error) {
			notifiedURL = url
			return "notify command failed: expected exit code 0, actual 1", nil
		},
	})
	if code != 0 {
		t.Fatal(code)
	}
	if stderr != "warning: question 2 has no --default and no --answerBy: work blocks until the human answers; give both unless there is no safe default\nnotify command failed: expected exit code 0, actual 1\n" {
		t.Fatalf("stderr = %q", stderr)
	}
	if !strings.Contains(stdout, "\"id\": \"2\"") {
		t.Fatalf("stdout = %q", stdout)
	}
	if notifiedURL != "http://127.0.0.1:47800/p/a%20b/dashboard#q-2" {
		t.Fatalf("url = %q", notifiedURL)
	}
}

func TestWaitTimeoutExits2(t *testing.T) {
	stdout, stderr, code := runCLI(t, []string{"question", "wait", "7", "--timeout", "0s"}, "", &services{
		now: fixedNow, workingDirectory: fixedDirectory, open: fixedOpen, register: noopRegister,
		monotonic: func() time.Time { return time.Unix(0, 0) },
		sleep:     func(time.Duration) { t.Fatal("sleep") },
		getQuestion: func(workspace.Workspace, string) (questions.Question, error) {
			return questions.Question{ID: "7", Status: "open", Options: []string{}}, nil
		},
		acknowledgeQuestion: func(workspace.Workspace, string) (questions.Question, error) {
			return questions.Question{ID: "7", Status: "open", Options: []string{}}, nil
		},
	})
	if code != 2 {
		t.Fatalf("code = %d, want 2", code)
	}
	if stderr != "timed out after 0s waiting for question 7\n" {
		t.Fatalf("stderr = %q", stderr)
	}
	if !strings.Contains(stdout, "\"status\": \"open\"") {
		t.Fatalf("stdout = %q", stdout)
	}
}

func TestServePortAndInitOrder(t *testing.T) {
	var port int
	served := false
	_, stderr, code := runCLI(t, []string{"serve", "--port", "0"}, "", &services{
		now: fixedNow, workingDirectory: fixedDirectory,
		open: func(string) (workspace.Workspace, error) {
			return workspace.Workspace{}, errors.New("not a yaru workspace (run yaru init)")
		},
		serve: func(got int) error { served = true; port = got; return nil },
	})
	if code != 1 || stderr != "invalid port: 0\n" || served {
		t.Fatalf("code %d stderr %q served %v", code, stderr, served)
	}
	_, _, code = runCLI(t, []string{"serve", "--port", "1e2"}, "", &services{
		now: fixedNow, workingDirectory: fixedDirectory,
		open:     func(string) (workspace.Workspace, error) { return workspace.Workspace{}, errors.New("missing") },
		register: noopRegister,
		serve:    func(got int) error { port = got; return nil },
	})
	if code != 0 || port != 100 {
		t.Fatalf("code %d port %d", code, port)
	}
	_, _, code = runCLI(t, []string{"serve", "-p", "80", "--port", ""}, "", &services{
		now: fixedNow, workingDirectory: fixedDirectory,
		open:  func(string) (workspace.Workspace, error) { return workspace.Workspace{}, errors.New("missing") },
		serve: func(got int) error { port = got; return nil },
	})
	if code != 0 || port != 80 {
		t.Fatalf("empty --port should fall through to -p, code %d port %d", code, port)
	}

	var order []string
	stdout, _, code := runCLI(t, []string{"init", "extra"}, "", &services{
		now: fixedNow,
		workingDirectory: func() (string, error) {
			order = append(order, "cwd")
			return "/tmp/ws", nil
		},
		init: func(directory string) (workspace.Workspace, error) {
			order = append(order, "init")
			return workspace.Workspace{Root: directory, Directory: directory + "/.yaru"}, nil
		},
		ensureQuestionsDirectory: func(workspace.Workspace) error {
			order = append(order, "questions")
			return nil
		},
		register: func(workspace.Workspace) error {
			order = append(order, "register")
			return nil
		},
	})
	if code != 0 || stdout != "initialized /tmp/ws/.yaru\n" {
		t.Fatalf("code %d stdout %q", code, stdout)
	}
	if strings.Join(order, ",") != "cwd,init,questions,register" {
		t.Fatalf("order = %v", order)
	}
}

func TestPatchErrorQuotesLikeJSONStringify(t *testing.T) {
	_, stderr, code := runCLI(t, []string{"issue", "save", "--patch", "{\n"}, "", &services{now: fixedNow})
	if code != 1 || stderr != "invalid patch: expected a JSON array of operations, actual \"{\\n\"\n" {
		t.Fatalf("code %d stderr %q", code, stderr)
	}
}

func TestHumanSavePrintsBoardURL(t *testing.T) {
	var fetched string
	stdout, _, code := runCLI(t, []string{"issue", "save", "--title", "T", "-f"}, "", &services{
		now: fixedNow, workingDirectory: fixedDirectory, open: fixedOpen, register: noopRegister,
		findSlug: func(string) (string, error) { return "workspace", nil },
		readProvenance: func(string, []string) (workspace.Provenance, error) {
			return workspace.Provenance{}, nil
		},
		saveIssue: func(workspace.Workspace, store.SaveInput, store.SaveOptions) (store.Issue, error) {
			return store.Issue{ID: "1", Title: "T", Status: "todo", Labels: []string{}, Blocks: []string{}, BlockedBy: []string{}, Children: []string{}}, nil
		},
		fetchIssue: func(url string) (bool, error) {
			fetched = url
			return true, nil
		},
	})
	if code != 0 {
		t.Fatal(code)
	}
	if stdout != "1\nhttp://127.0.0.1:47800/p/workspace/?id=1\n" {
		t.Fatalf("stdout = %q", stdout)
	}
	if fetched != "http://127.0.0.1:47800/p/workspace/api/issues/1" {
		t.Fatalf("fetched = %q", fetched)
	}
}

func replaySnapshot(t *testing.T, name string) {
	t.Helper()
	path := filepath.Join("..", "..", "spec", "golden", "snapshots", name+".json")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot struct {
		Steps []struct {
			Arguments []string `json:"arguments"`
			Stdin     string   `json:"stdin"`
			Now       string   `json:"now"`
			Stdout    string   `json:"stdout"`
			Stderr    string   `json:"stderr"`
			ExitCode  int      `json:"exitCode"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(body, &snapshot); err != nil {
		t.Fatal(err)
	}
	for index, step := range snapshot.Steps {
		t.Setenv("YARU_NOW", step.Now)
		stdout, stderr, code := runCLI(t, step.Arguments, step.Stdin, nil)
		if code != step.ExitCode || stdout != step.Stdout || stderr != step.Stderr {
			t.Fatalf("step %d %#v\ncode %d want %d\nstdout %q\nwant %q\nstderr %q\nwant %q", index, step.Arguments, code, step.ExitCode, stdout, step.Stdout, stderr, step.Stderr)
		}
	}
}

func runCLI(t *testing.T, arguments []string, stdin string, active *services) (string, string, int) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := Run(Invocation{
		Arguments: arguments,
		Stdin:     strings.NewReader(stdin),
		Stdout:    &stdout,
		Stderr:    &stderr,
		services:  active,
	})
	return stdout.String(), stderr.String(), code
}

func fixedNow() (time.Time, error) { return time.Unix(0, 0).UTC(), nil }

func fixedDirectory() (string, error) { return "/tmp/ws", nil }

func fixedOpen(string) (workspace.Workspace, error) {
	return workspace.Workspace{Root: "/tmp/ws", Directory: "/tmp/ws/.yaru"}, nil
}

func noopRegister(workspace.Workspace) error { return nil }
