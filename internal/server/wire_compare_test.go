//declscope:core

package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
	"github.com/aovoq/yaru/internal/workspace"
)

// つないだ Go のサーバと、同じ fixture に向けた TS の yaru serve を比べる。
// 揃え方は docs/spec/routes.md の「新旧の返事の揃え方」。常駐の 47800 と 47811 は使わない。
func TestWiredServerMatchesTypeScriptServe(t *testing.T) {
	compareWorktree = moduleRoot()
	t.Cleanup(func() { compareWorktree = "" })
	fixture, stateDirectory, home := newCompareFixture(t)
	t.Setenv("YARU_STATE_DIR", stateDirectory)
	t.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	t.Setenv("YARU_PUBLIC_HOST", "")
	t.Setenv("HOME", home)
	t.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("TZ", "Asia/Tokyo")
	runBun(t, fixture, stateDirectory, home, "init")
	runBun(t, fixture, stateDirectory, home, "issue", "save", "--title", "Hello", "--body", "line")
	slug := registeredSlug(t, stateDirectory, fixture)
	previousDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(fixture); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(previousDirectory) })
	stopTS := startTypeScriptServe(t, fixture, stateDirectory, home, 47901)
	t.Cleanup(stopTS)
	goServer := startWiredServer(t, 47900)
	t.Cleanup(func() { _ = goServer.Close() })
	waitHTTP(t, "http://127.0.0.1:47901/manifest.webmanifest")
	waitHTTP(t, goServer.URL()+"/manifest.webmanifest")

	tsIssues := getJSON(t, "http://127.0.0.1:47901/p/"+slug+"/api/issues")
	goIssues := postJSON(t, goServer.URL()+yaruv1connect.IssueServiceListIssuesProcedure, `{"workspace":"`+slug+`"}`)
	if goIssues["now"] != "2026-09-28T12:00:00.000Z" {
		t.Fatalf("list now: expected 2026-09-28T12:00:00.000Z, actual %#v", goIssues["now"])
	}
	assertAlignedJSON(t, "list issues", tsIssues, goIssues["issues"])

	tsIssue := getJSON(t, "http://127.0.0.1:47901/p/"+slug+"/api/issues/1")
	goIssue := postJSON(t, goServer.URL()+yaruv1connect.IssueServiceGetIssueProcedure, `{"workspace":"`+slug+`","id":"1"}`)
	assertAlignedJSON(t, "get issue", tsIssue, goIssue["issue"])

	tsMissingBody, tsMissingStatus := getRaw(t, "http://127.0.0.1:47901/p/"+slug+"/api/issues/9")
	goMissingBody, goMissingStatus := postRaw(t, goServer.URL()+yaruv1connect.IssueServiceGetIssueProcedure, `{"workspace":"`+slug+`","id":"9"}`)
	if tsMissingStatus != http.StatusNotFound {
		t.Fatalf("ts missing issue: expected 404, actual %d %s", tsMissingStatus, tsMissingBody)
	}
	tsError := jsonStringField(t, tsMissingBody, "error")
	goMessage := connectMessage(t, goMissingBody)
	if goMissingStatus != http.StatusNotFound || goMessage != tsError {
		t.Fatalf("missing issue: ts %d %s go %d %s", tsMissingStatus, tsError, goMissingStatus, goMessage)
	}

	tsPageBody, tsPageStatus := getRaw(t, "http://127.0.0.1:47901/p/"+slug+"/api/page")
	goPage := postJSON(t, goServer.URL()+yaruv1connect.PageServiceGetPageProcedure, `{"workspace":"`+slug+`"}`)
	if tsPageStatus != http.StatusOK {
		t.Fatalf("ts page: %d %s", tsPageStatus, tsPageBody)
	}
	var tsPage any
	if err := json.Unmarshal(tsPageBody, &tsPage); err != nil {
		t.Fatal(err)
	}
	assertAlignedJSON(t, "page", tsPage, goPage)

	tsInbox := getJSON(t, "http://127.0.0.1:47901/api/inbox")
	goInbox := postJSON(t, goServer.URL()+yaruv1connect.InboxServiceGetInboxProcedure, `{}`)
	assertAlignedJSON(t, "inbox", tsInbox, goInbox)

	tsComments := getJSON(t, "http://127.0.0.1:47901/p/"+slug+"/api/comments?issue=1")
	goComments := postJSON(t, goServer.URL()+yaruv1connect.CommentServiceListCommentsProcedure, `{"workspace":"`+slug+`","issue":"1"}`)
	assertAlignedJSON(t, "comments", tsComments, goComments["comments"])

	tsQuestions := getJSON(t, "http://127.0.0.1:47901/p/"+slug+"/api/questions")
	goQuestions := postJSON(t, goServer.URL()+yaruv1connect.QuestionServiceListQuestionsProcedure, `{"workspace":"`+slug+`"}`)
	assertAlignedJSON(t, "questions", tsQuestions, goQuestions)

	goDashboard := postJSON(t, goServer.URL()+yaruv1connect.DashboardServiceGetDashboardProcedure, `{"workspace":"`+slug+`"}`)
	if goDashboard["now"] != "2026-09-28T12:00:00.000Z" {
		t.Fatalf("dashboard now: %#v", goDashboard["now"])
	}

	goCopy, tsCopy := duplicateFixture(t, fixture, stateDirectory)
	goSlug := registeredSlug(t, stateDirectory, goCopy)
	tsSlug := registeredSlug(t, stateDirectory, tsCopy)
	postRaw(t, goServer.URL()+yaruv1connect.IssueServiceSaveIssueProcedure, `{"workspace":"`+goSlug+`","title":"Created","body":"from go\n"}`)
	postRaw(t, "http://127.0.0.1:47901/p/"+tsSlug+"/api/issues", `{"title":"Created","body":"from go\n"}`)
	goFile := readCompareFile(t, filepath.Join(goCopy, ".yaru", "issues", "2.md"))
	tsFile := readCompareFile(t, filepath.Join(tsCopy, ".yaru", "issues", "2.md"))
	if goFile != tsFile {
		t.Fatalf("created issue file\n--- go\n%s\n--- ts\n%s", goFile, tsFile)
	}
}

func newCompareFixture(t *testing.T) (string, string, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "fixture")
	stateDirectory := filepath.Join(t.TempDir(), "state")
	home := filepath.Join(t.TempDir(), "home")
	for _, directory := range []string{root, stateDirectory, home} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	gitCommand(t, root, home, "init")
	gitCommand(t, root, home, "config", "user.name", "yaru")
	gitCommand(t, root, home, "config", "user.email", "yaru@example.com")
	return root, stateDirectory, home
}

func duplicateFixture(t *testing.T, source string, stateDirectory string) (string, string) {
	t.Helper()
	goCopy := filepath.Join(t.TempDir(), "go-copy")
	tsCopy := filepath.Join(t.TempDir(), "ts-copy")
	copyFixture(t, source, goCopy)
	copyFixture(t, source, tsCopy)
	if _, err := workspace.RegisterIn(goCopy, stateDirectory); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.RegisterIn(tsCopy, stateDirectory); err != nil {
		t.Fatal(err)
	}
	return goCopy, tsCopy
}

func copyFixture(t *testing.T, from string, to string) {
	t.Helper()
	if err := os.MkdirAll(to, 0o755); err != nil {
		t.Fatal(err)
	}
	err := filepath.WalkDir(from, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(from, path)
		if err != nil {
			return err
		}
		target := filepath.Join(to, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
}

func startWiredServer(t *testing.T, port int) *Running {
	t.Helper()
	built := newTestServer(t, Configuration{Port: port, WireServices: true, StartupOutput: io.Discard})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	waitHTTP(t, running.URL()+"/manifest.webmanifest")
	return running
}

func startTypeScriptServe(t *testing.T, fixture string, stateDirectory string, home string, port int) func() {
	t.Helper()
	script := `
process.chdir(process.env.FIXTURE)
process.argv = ["bun", "yaru", "serve", "-p", process.env.YARU_PORT]
await import(process.env.YARU_ENTRY)
`
	command := exec.Command("bun", "-e", script)
	command.Dir = moduleRoot()
	command.Env = bunEnvironment(fixture, stateDirectory, home, map[string]string{
		"FIXTURE":    fixture,
		"YARU_ENTRY": filepath.Join(moduleRoot(), "src", "index.ts"),
		"YARU_PORT":  fmt.Sprintf("%d", port),
	})
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = command.Stdout
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	started := make(chan string, 1)
	go func() {
		buffer := make([]byte, 4096)
		collected := ""
		for {
			count, readErr := output.Read(buffer)
			if count > 0 {
				collected += string(buffer[:count])
				if strings.Contains(collected, "http://127.0.0.1:") {
					started <- collected
					return
				}
			}
			if readErr != nil {
				started <- collected
				return
			}
		}
	}()
	select {
	case text := <-started:
		if !strings.Contains(text, fmt.Sprintf("http://127.0.0.1:%d", port)) {
			_ = command.Process.Kill()
			t.Fatalf("ts serve did not listen: %s", text)
		}
	case <-time.After(20 * time.Second):
		_ = command.Process.Kill()
		t.Fatal("ts serve timed out")
	}
	return func() {
		_ = command.Process.Kill()
		_ = command.Wait()
	}
}

func runBun(t *testing.T, fixture string, stateDirectory string, home string, args ...string) {
	t.Helper()
	encoded, err := json.Marshal(append([]string{"bun", "yaru"}, args...))
	if err != nil {
		t.Fatal(err)
	}
	script := `
process.chdir(process.env.FIXTURE)
process.argv = JSON.parse(process.env.YARU_ARGV)
await import(process.env.YARU_ENTRY)
`
	command := exec.Command("bun", "-e", script)
	command.Dir = moduleRoot()
	command.Env = bunEnvironment(fixture, stateDirectory, home, map[string]string{
		"FIXTURE":    fixture,
		"YARU_ENTRY": filepath.Join(moduleRoot(), "src", "index.ts"),
		"YARU_ARGV":  string(encoded),
	})
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("bun %s: %v\n%s", strings.Join(args, " "), err, output)
	}
}

func bunEnvironment(fixture string, stateDirectory string, home string, extra map[string]string) []string {
	environment := []string{
		"HOME=" + home,
		"YARU_STATE_DIR=" + stateDirectory,
		"YARU_NOW=2026-09-28T12:00:00.000Z",
		"YARU_PUBLIC_HOST=",
		"TZ=Asia/Tokyo",
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_NOSYSTEM=1",
		"PATH=" + os.Getenv("PATH"),
	}
	for key, value := range extra {
		environment = append(environment, key+"="+value)
	}
	_ = fixture
	return environment
}

func gitCommand(t *testing.T, root string, home string, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = root
	command.Env = []string{
		"HOME=" + home,
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_NOSYSTEM=1",
		"PATH=" + os.Getenv("PATH"),
	}
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
}

var compareWorktree string

func moduleRoot() string {
	if compareWorktree != "" {
		return compareWorktree
	}
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		return filepath.Join("..", "..")
	}
	return root
}

func registeredSlug(t *testing.T, stateDirectory string, root string) string {
	t.Helper()
	physicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		physicalRoot = root
	}
	data, err := os.ReadFile(filepath.Join(stateDirectory, "workspaces.json"))
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Workspaces []struct {
			Slug string `json:"slug"`
			Root string `json:"root"`
		} `json:"workspaces"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatal(err)
	}
	for _, entry := range parsed.Workspaces {
		if entry.Root == root || entry.Root == physicalRoot {
			return entry.Slug
		}
	}
	t.Fatalf("slug not found for %s in %s", root, data)
	return ""
}

func waitHTTP(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	var last error
	for time.Now().Before(deadline) {
		response, err := http.Get(url)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK || response.StatusCode == http.StatusForbidden {
				return
			}
		}
		last = err
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s: %v", url, last)
}

func getJSON(t *testing.T, url string) any {
	t.Helper()
	body, status := getRaw(t, url)
	if status != http.StatusOK {
		t.Fatalf("GET %s: %d %s", url, status, body)
	}
	var parsed any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("GET %s json: %v %s", url, err, body)
	}
	return parsed
}

func postJSON(t *testing.T, url string, payload string) map[string]any {
	t.Helper()
	body, status := postRaw(t, url, payload)
	if status != http.StatusOK {
		t.Fatalf("POST %s: %d %s", url, status, body)
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed
}

func getRaw(t *testing.T, url string) ([]byte, int) {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return body, response.StatusCode
}

func postRaw(t *testing.T, url string, payload string) ([]byte, int) {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, url, strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return body, response.StatusCode
}

func assertAlignedJSON(t *testing.T, name string, typescriptValue any, goValue any) {
	t.Helper()
	left := stableJSON(t, alignValue(typescriptValue))
	right := stableJSON(t, alignValue(goValue))
	if left != right {
		t.Fatalf("%s\n--- ts\n%s\n--- go\n%s", name, left, right)
	}
}

func stableJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	if err := json.Indent(&buffer, encoded, "", "  "); err != nil {
		t.Fatal(err)
	}
	return buffer.String()
}

func alignValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		aligned := map[string]any{}
		for key, item := range typed {
			if key == "now" || item == nil {
				continue
			}
			aligned[key] = alignValue(item)
		}
		return aligned
	case []any:
		aligned := make([]any, 0, len(typed))
		for _, item := range typed {
			aligned = append(aligned, alignValue(item))
		}
		return aligned
	case string:
		if old, found := oldEnumName[typed]; found {
			return old
		}
		return typed
	default:
		return value
	}
}

var oldEnumName = map[string]string{
	"ISSUE_STATUS_BACKLOG":        "backlog",
	"ISSUE_STATUS_TODO":           "todo",
	"ISSUE_STATUS_IN_PROGRESS":    "in_progress",
	"ISSUE_STATUS_DONE":           "done",
	"ISSUE_STATUS_CANCELED":       "canceled",
	"ISSUE_PRIORITY_URGENT":       "urgent",
	"ISSUE_PRIORITY_HIGH":         "high",
	"ISSUE_PRIORITY_MEDIUM":       "medium",
	"ISSUE_PRIORITY_LOW":          "low",
	"QUESTION_STATUS_OPEN":        "open",
	"QUESTION_STATUS_EXPIRED":     "expired",
	"QUESTION_STATUS_ANSWERED":    "answered",
	"QUESTION_STATUS_CANCELED":    "canceled",
	"ISSUE_SORT_PRIORITY":         "priority",
	"ISSUE_SORT_UPDATED":          "updated",
	"ISSUE_SORT_CREATED":          "created",
	"ISSUE_SORT_DUE":              "due",
	"ISSUE_GROUP_STATUS":          "status",
	"ISSUE_GROUP_LABEL":           "label",
	"ISSUE_GROUP_NONE":            "none",
	"ISSUE_GROUP_PRIORITY":        "priority",
	"COMPLETED_VISIBILITY_HIDE":   "hide",
	"COMPLETED_VISIBILITY_RECENT": "recent",
	"COMPLETED_VISIBILITY_ALL":    "all",
	"ISSUE_VIEW_LIST":             "list",
	"ISSUE_VIEW_BOARD":            "board",
	"PATCH_OP_KIND_REPLACE":       "replace",
	"PATCH_OP_KIND_INSERT_BEFORE": "insert_before",
	"PATCH_OP_KIND_INSERT_AFTER":  "insert_after",
	"PATCH_OP_KIND_PREPEND":       "prepend",
	"PATCH_OP_KIND_APPEND":        "append",
	"PATCH_OP_KIND_REPLACE_RANGE": "replace_range",
}

func jsonStringField(t *testing.T, body []byte, key string) string {
	t.Helper()
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("json: %v %s", err, body)
	}
	value, _ := parsed[key].(string)
	return value
}

func connectMessage(t *testing.T, body []byte) string {
	t.Helper()
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("connect json: %v %s", err, body)
	}
	message, _ := parsed["message"].(string)
	return message
}

func readCompareFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
