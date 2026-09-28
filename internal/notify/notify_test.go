package notify_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aovoq/yaru/internal/notify"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/workspace"
)

func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "yaru-notify-home-")
	if err != nil {
		panic(err)
	}
	if err := os.MkdirAll(filepath.Join(home, "state"), 0o755); err != nil {
		panic(err)
	}
	_ = os.Setenv("HOME", home)
	_ = os.Setenv("YARU_STATE_DIR", filepath.Join(home, "state"))
	_ = os.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	_ = os.Setenv("TZ", "Asia/Tokyo")
	code := m.Run()
	_ = os.RemoveAll(home)
	os.Exit(code)
}

func TestQuestionURLEncodesSlugAndID(t *testing.T) {
	if got := notify.QuestionURL("http://127.0.0.1:47800", "Asuka Travel", "3"); got != "http://127.0.0.1:47800/p/Asuka%20Travel/dashboard#q-3" {
		t.Fatal(got)
	}
	if got := notify.QuestionURL("https://mac.example.ts.net///", "a/b", "q id"); got != "https://mac.example.ts.net/p/a%2Fb/dashboard#q-q%20id" {
		t.Fatal(got)
	}
	if got := notify.EncodeURIComponent("Az09-_.!~*'()"); got != "Az09-_.!~*'()" {
		t.Fatal(got)
	}
	if got := notify.EncodeURIComponent("あ"); got != "%E3%81%82" {
		t.Fatal(got)
	}
}

func TestBaseURLReadsPublicURL(t *testing.T) {
	opened := newWorkspace(t)
	writeConfig(t, opened, "publicUrl: https://mac.example.ts.net/\n")
	got, err := notify.BaseURL(context.Background(), opened, "http://127.0.0.1:47800")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://mac.example.ts.net" {
		t.Fatal(got)
	}
	writeConfig(t, opened, "")
	got, err = notify.BaseURL(context.Background(), opened, "http://127.0.0.1:47800")
	if err != nil {
		t.Fatal(err)
	}
	if got != "http://127.0.0.1:47800" {
		t.Fatal(got)
	}
	missing := newWorkspace(t)
	got, err = notify.BaseURL(context.Background(), missing, "http://fallback")
	if err != nil || got != "http://fallback" {
		t.Fatalf("%q %v", got, err)
	}
}

func TestQuestionCreatedWithoutCommand(t *testing.T) {
	opened := newWorkspace(t)
	writeConfig(t, opened, "publicUrl: https://mac.example.ts.net\n")
	warning, err := notify.QuestionCreated(context.Background(), opened, "http://x", sampleQuestion(), nil)
	if err != nil || warning != "" {
		t.Fatalf("%q %v", warning, err)
	}
}

func TestQuestionCreatedReportsCommandFailure(t *testing.T) {
	opened := newWorkspace(t)
	writeConfig(t, opened, "notify: echo boom >&2; exit 3\n")
	warning, err := notify.QuestionCreated(context.Background(), opened, "http://x", sampleQuestion(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if warning != "notify command failed: expected exit code 0, actual 3: boom" {
		t.Fatal(warning)
	}
}

func TestQuestionCreatedReportsExitCodeBeforeDeadline(t *testing.T) {
	opened := newWorkspace(t)
	writeConfig(t, opened, "notify: exit 4\n")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	warning, err := notify.QuestionCreated(ctx, opened, "http://x", sampleQuestion(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if warning != "notify command failed: expected exit code 0, actual 4" {
		t.Fatal(warning)
	}
}

func TestQuestionCreatedTimesOut(t *testing.T) {
	opened := newWorkspace(t)
	writeConfig(t, opened, "notify: while :; do :; done\n")
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	warning, err := notify.QuestionCreated(ctx, opened, "http://x", sampleQuestion(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if warning != "notify command failed: expected to finish within 10000ms, actual timed out" {
		t.Fatal(warning)
	}
}

func TestQuestionCreatedUsesOnlyGivenEnvironment(t *testing.T) {
	t.Setenv("HOME", "/weird-process-home")
	t.Setenv("YARU_NOW", "not-a-time")
	t.Setenv("YARU_STATE_DIR", "/weird-process-state")
	opened := newWorkspace(t)
	received := filepath.Join(opened.Root, "received.json")
	envFile := filepath.Join(opened.Root, "env.txt")
	command := "while IFS= read -r line || [ -n \"$line\" ]; do printf '%s\\n' \"$line\"; done > " + shellQuote(received) +
		"; printf '%s\\n' \"$HOME\" \"$YARU_EVENT\" \"$YARU_NOW\" \"$YARU_STATE_DIR\" > " + shellQuote(envFile) + "\n"
	writeConfig(t, opened, "notify: "+command)
	url := "http://127.0.0.1:47800/p/app/dashboard#q-3"
	warning, err := notify.QuestionCreated(context.Background(), opened, url, sampleQuestion(), []string{
		"HOME=/from-argument",
		"YARU_STATE_DIR=/from-argument-state",
	})
	if err != nil || warning != "" {
		t.Fatalf("%q %v", warning, err)
	}
	payload, err := os.ReadFile(received)
	if err != nil {
		t.Fatal(err)
	}
	var event struct {
		Event    string `json:"event"`
		URL      string `json:"url"`
		Question struct {
			ID      string   `json:"id"`
			Title   string   `json:"title"`
			Status  string   `json:"status"`
			Options []string `json:"options"`
		} `json:"question"`
	}
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatalf("%v\n%s", err, payload)
	}
	if event.Event != "question.created" || event.URL != url || event.Question.ID != "3" || event.Question.Title != "soon" || event.Question.Status != "open" || len(event.Question.Options) != 0 {
		t.Fatalf("%s", payload)
	}
	envText, err := os.ReadFile(envFile)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(envText), "\n"), "\n")
	if len(lines) != 4 || lines[0] != "/from-argument" || lines[1] != "question.created" || lines[2] != "" || lines[3] != "/from-argument-state" {
		t.Fatalf("%q", envText)
	}

	nilReceived := filepath.Join(opened.Root, "nil-env.txt")
	writeConfig(t, opened, "notify: printf '%s\\n' \"HOME=$HOME\" \"NOW=$YARU_NOW\" \"EVENT=$YARU_EVENT\" > "+shellQuote(nilReceived)+"\n")
	warning, err = notify.QuestionCreated(context.Background(), opened, url, sampleQuestion(), nil)
	if err != nil || warning != "" {
		t.Fatalf("%q %v", warning, err)
	}
	nilText, err := os.ReadFile(nilReceived)
	if err != nil {
		t.Fatal(err)
	}
	if string(nilText) != "HOME=\nNOW=\nEVENT=question.created\n" {
		t.Fatalf("%q", nilText)
	}
}

func newWorkspace(t *testing.T) workspace.Workspace {
	t.Helper()
	root := t.TempDir()
	directory := filepath.Join(root, ".yaru")
	if err := os.Mkdir(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	return workspace.Workspace{Root: root, Directory: directory}
}

func writeConfig(t *testing.T, opened workspace.Workspace, text string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(opened.Directory, "config.yml"), []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func sampleQuestion() questions.Question {
	return questions.Question{
		ID:        "3",
		Title:     "soon",
		Status:    "open",
		Author:    "spec",
		Options:   []string{},
		CreatedAt: "2026-09-25T09:00:00.000Z",
		UpdatedAt: "2026-09-25T09:00:00.000Z",
		Body:      "body",
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}
