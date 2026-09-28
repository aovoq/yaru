//declscope:core
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/sessions"
	"github.com/aovoq/yaru/internal/workspace"
)

// テストが本物の ~/.local/state/yaru と HOME を触らないようにする。
// docs/spec/yaru-format.md の「状態ディレクトリ」。src/web.tsx の JSON とフォーム。

var repositoryDirectory string

// yaruBinary は cmd/yaru をビルドした CLI。golden (testdata/golden) で CLI の出力の同一性は確かめてある
var yaruBinary string

func TestMain(m *testing.M) {
	workingDirectory, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	repositoryDirectory = moduleRoot(workingDirectory)
	// HOME を一時ディレクトリに替える前にビルドし、Go のビルドのキャッシュを使う
	binaryDirectory, err := os.MkdirTemp("", "yaru-api-bin-")
	if err != nil {
		panic(err)
	}
	yaruBinary = filepath.Join(binaryDirectory, "yaru")
	build := exec.Command("go", "build", "-o", yaruBinary, "./cmd/yaru")
	build.Dir = repositoryDirectory
	if output, buildErr := build.CombinedOutput(); buildErr != nil {
		panic(fmt.Sprintf("go build ./cmd/yaru failed: %v\n%s", buildErr, output))
	}
	stateDirectory, err := os.MkdirTemp("", "yaru-api-state-")
	if err != nil {
		panic(err)
	}
	homeDirectory, err := os.MkdirTemp("", "yaru-api-home-")
	if err != nil {
		panic(err)
	}
	mustSetEnvironment("YARU_STATE_DIR", stateDirectory)
	mustSetEnvironment("HOME", homeDirectory)
	mustSetEnvironment("YARU_NOW", fixedNow)
	mustSetEnvironment("TZ", "Asia/Tokyo")
	mustSetEnvironment("GIT_CONFIG_GLOBAL", "/dev/null")
	mustSetEnvironment("GIT_CONFIG_NOSYSTEM", "1")
	mustSetEnvironment("GIT_AUTHOR_NAME", "Spec Author")
	mustSetEnvironment("GIT_AUTHOR_EMAIL", "spec@example.com")
	mustSetEnvironment("GIT_COMMITTER_NAME", "Spec Author")
	mustSetEnvironment("GIT_COMMITTER_EMAIL", "spec@example.com")
	// セッション ID が残ると、CLI が書く質問の session が実行する環境ごとに変わり、記録と合わなくなる
	for _, name := range []string{"XDG_STATE_HOME", "CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID"} {
		if err := os.Unsetenv(name); err != nil {
			panic(err)
		}
	}
	location, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		panic(err)
	}
	time.Local = location
	code := m.Run()
	if err := os.RemoveAll(stateDirectory); err != nil {
		panic(err)
	}
	if err := os.RemoveAll(homeDirectory); err != nil {
		panic(err)
	}
	if err := os.RemoveAll(binaryDirectory); err != nil {
		panic(err)
	}
	os.Exit(code)
}

func mustSetEnvironment(name string, value string) {
	if err := os.Setenv(name, value); err != nil {
		panic(err)
	}
}

func moduleRoot(start string) string {
	directory := start
	for {
		if _, err := os.Stat(filepath.Join(directory, "go.mod")); err == nil {
			return directory
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			panic("go.mod not found from " + start)
		}
		directory = parent
	}
}

func physicalTemp(t *testing.T) string {
	t.Helper()
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return directory
}

func namedRoot(t *testing.T, name string) string {
	t.Helper()
	root := filepath.Join(physicalTemp(t), name)
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

func runGit(t *testing.T, directory string, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	command.Env = os.Environ()
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
}

func initRepositoryGit(t *testing.T, root string) {
	t.Helper()
	runGit(t, root, "init", "--quiet", "--initial-branch", "main")
	runGit(t, root, "config", "user.name", "Spec Author")
	runGit(t, root, "config", "user.email", "spec@example.com")
}

func environmentWith(overrides map[string]string) []string {
	filtered := []string{}
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if _, replaced := overrides[name]; replaced {
			continue
		}
		filtered = append(filtered, entry)
	}
	for name, value := range overrides {
		filtered = append(filtered, name+"="+value)
	}
	return filtered
}

func runYaru(t *testing.T, root string, stateDirectory string, args ...string) string {
	t.Helper()
	command := exec.Command(yaruBinary, args...)
	command.Dir = root
	command.Env = environmentWith(map[string]string{"YARU_STATE_DIR": stateDirectory})
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		t.Fatalf("yaru %v: %v\n%s\n%s", args, err, stdout.String(), stderr.String())
	}
	return stdout.String()
}

func runBun(t *testing.T, root string, stateDirectory string, variables map[string]string, script string) string {
	t.Helper()
	overrides := map[string]string{
		"COMPARE_ROOT":   root,
		"YARU_STATE_DIR": stateDirectory,
		"COMPARE_STATE":  stateDirectory,
	}
	for name, value := range variables {
		overrides[name] = value
	}
	command := exec.Command("bun", "-")
	command.Dir = repositoryDirectory
	command.Env = environmentWith(overrides)
	command.Stdin = strings.NewReader(script)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		t.Fatalf("bun: %v\n%s\n%s", err, stdout.String(), stderr.String())
	}
	return stdout.String()
}

const webScript = `
const root = process.env.COMPARE_ROOT
const action = process.env.COMPARE_ACTION
const { createApp, createServerApp } = await import("./src/web.tsx")
const { open, saveIssue } = await import("./src/store.ts")
const { saveQuestion, acknowledgeQuestion } = await import("./src/questions.ts")
const { currentTime } = await import("./src/time.ts")
const { notifyExpiringQuestions, notifyStaleIssues, notify } = await import("./src/notify.ts")
const { readSessionHealth } = await import("./src/sessions.ts")
const { readRepositoryState } = await import("./src/repository.ts")
const { listQuestions } = await import("./src/questions.ts")
const { listIssues } = await import("./src/store.ts")

process.chdir(root)
const now = currentTime()

if (action === "seed-issue") {
  const store = open(root)
  saveIssue(store, { title: process.env.COMPARE_TITLE, status: process.env.COMPARE_STATUS || "todo" }, { now })
  console.log("{}")
  process.exit(0)
}
if (action === "seed-question") {
  const store = open(root)
  const input = { title: process.env.COMPARE_TITLE }
  if (process.env.COMPARE_ISSUE) input.issue = process.env.COMPARE_ISSUE
  if (process.env.COMPARE_ANSWER_BY) input.answerBy = process.env.COMPARE_ANSWER_BY
  if (process.env.COMPARE_DEFAULT) input.defaultAction = process.env.COMPARE_DEFAULT
  saveQuestion(store, input, now)
  console.log("{}")
  process.exit(0)
}
if (action === "acknowledge") {
  acknowledgeQuestion(open(root), process.env.COMPARE_ID, now)
  console.log("{}")
  process.exit(0)
}
if (action === "inbox") {
  const app = createServerApp(process.env.COMPARE_STATE)
  const response = await app.request("/api/inbox")
  console.log(JSON.stringify({ status: response.status, body: await response.text() }))
  process.exit(0)
}
if (action === "dashboard") {
  const store = open(root)
  console.log(JSON.stringify({
    questions: listQuestions(store, {}, now),
    issues: listIssues(store, {}, now),
    sessionHealth: readSessionHealth(store.root, { now }),
    repository: readRepositoryState(store.root),
    now: now.toISOString(),
  }))
  process.exit(0)
}
if (action === "notify-expiring") {
  const warnings = await notifyExpiringQuestions(process.env.COMPARE_STATE, now, process.env.COMPARE_BASE)
  console.log(JSON.stringify({ warnings }))
  process.exit(0)
}
if (action === "notify-stale") {
  const warnings = await notifyStaleIssues(process.env.COMPARE_STATE, now, process.env.COMPARE_BASE)
  console.log(JSON.stringify({ warnings }))
  process.exit(0)
}
if (action === "notify-created") {
  const store = open(root)
  const warning = notify(store, JSON.parse(process.env.COMPARE_JSON))
  console.log(JSON.stringify({ warning }))
  process.exit(0)
}

const store = open(root)
const app = createApp(store, { basePath: "/p/" + process.env.COMPARE_SLUG, workspaceName: process.env.COMPARE_SLUG })
let response
if (action === "json-answer") {
  response = await app.request("/api/questions/" + process.env.COMPARE_ID + "/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: process.env.COMPARE_JSON,
  })
} else if (action === "form-answer") {
  response = await app.request("/questions/" + process.env.COMPARE_ID + "/answer", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: process.env.COMPARE_FORM,
  })
} else if (action === "json-cancel") {
  response = await app.request("/api/questions/" + process.env.COMPARE_ID + "/cancel", { method: "POST" })
} else if (action === "form-undo") {
  response = await app.request("/questions/" + process.env.COMPARE_ID + "/undo", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: process.env.COMPARE_FORM,
  })
} else if (action === "json-get") {
  response = await app.request("/api/questions/" + process.env.COMPARE_ID)
} else if (action === "json-list") {
  response = await app.request("/api/questions" + (process.env.COMPARE_QUERY || ""))
} else {
  throw new Error("unknown action " + action)
}
console.log(JSON.stringify({ status: response.status, body: await response.text(), location: response.headers.get("location") }))
`

// TS 版の答えは testdata/api/<テスト名>/<番号>-<動作>.json に記録する。
// YARU_RECORD_TYPESCRIPT=1 のときだけ TS 版 (bun) を動かして記録を書き、ふだんは記録を読む。
// 記録には、動作の結果 (payload) と、動作の直後の TS 側のワークスペース (.git を除く) と状態ディレクトリ (workspaces.json を除く) を残す。
// 読むときは、そのファイルをワークスペースと状態ディレクトリへ書き戻し、TS 版が動いたあとの状態を再現する。
var recordTypeScript = os.Getenv("YARU_RECORD_TYPESCRIPT") == "1"

var webActionCounts = map[string]int{}

type typeScriptRecord struct {
	Payload map[string]any    `json:"payload"`
	Root    map[string]string `json:"root"`
	State   map[string]string `json:"state"`
}

func webAction(t *testing.T, root string, stateDirectory string, variables map[string]string) map[string]any {
	t.Helper()
	if variables == nil {
		variables = map[string]string{}
	}
	// -count=2 でも番号が 1 から始まるよう、テストの終わりに数え直す
	if webActionCounts[t.Name()] == 0 {
		name := t.Name()
		t.Cleanup(func() { delete(webActionCounts, name) })
	}
	webActionCounts[t.Name()]++
	recordName := fmt.Sprintf("%02d-%s.json", webActionCounts[t.Name()], variables["COMPARE_ACTION"])
	recordPath := filepath.Join(repositoryDirectory, "testdata", "api", t.Name(), recordName)
	replacements := recordReplacements(root, stateDirectory)
	if recordTypeScript {
		stdout := runBun(t, root, stateDirectory, variables, webScript)
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("decode bun output: %v\n%s", err, stdout)
		}
		record := typeScriptRecord{
			Payload: payload,
			Root:    readRecordedTree(t, root, skipRootEntry),
			State:   readRecordedTree(t, stateDirectory, skipStateEntry),
		}
		writeTypeScriptRecord(t, recordPath, record, replacements)
		return payload
	}
	record := readTypeScriptRecord(t, recordPath, replacements)
	restoreRecordedTree(t, root, record.Root, skipRootEntry)
	restoreRecordedTree(t, stateDirectory, record.State, skipStateEntry)
	return record.Payload
}

type pathReplacement struct {
	actual      string
	placeholder string
}

// recordReplacements は毎回変わる一時ディレクトリを、記録の中の置き換え文字と対応させる。
// テストの一時ディレクトリ (t.TempDir が 001、002 と番号を振る親) を <TEMP> にする。番号は記録と再現で同じ順に振られる。
// 実パス (/private/tmp/...) と、symlink を通した表記 (/tmp/...) の両方を替え、長いパスから先に替える
func recordReplacements(root string, stateDirectory string) []pathReplacement {
	replacements := []pathReplacement{}
	for _, directory := range []string{testTemporaryParent(root), testTemporaryParent(stateDirectory)} {
		variants := []string{directory}
		if trimmed, found := strings.CutPrefix(directory, "/private/"); found {
			variants = append(variants, "/"+trimmed)
		}
		for _, variant := range variants {
			replacements = append(replacements, pathReplacement{actual: variant, placeholder: "<TEMP>"})
			// Claude のセッションのディレクトリ名は、パスの / と . を - にしたもの (sessions.ClaudeProjectDirectory)
			encoded := strings.NewReplacer("/", "-", ".", "-").Replace(variant)
			replacements = append(replacements, pathReplacement{actual: encoded, placeholder: "<TEMP-ENCODED>"})
		}
	}
	sort.SliceStable(replacements, func(left int, right int) bool {
		return len(replacements[left].actual) > len(replacements[right].actual)
	})
	return replacements
}

// testTemporaryParent は physicalTemp (.../<テスト名><乱数>/001) か namedRoot (.../001/app) のパスから、番号の親を返す
func testTemporaryParent(path string) string {
	directory := path
	for directory != filepath.Dir(directory) {
		if isTemporaryNumber(filepath.Base(directory)) {
			return filepath.Dir(directory)
		}
		directory = filepath.Dir(directory)
	}
	panic("temporary directory number not found in " + path)
}

func isTemporaryNumber(name string) bool {
	if len(name) != 3 {
		return false
	}
	for _, character := range name {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func writeTypeScriptRecord(t *testing.T, path string, record typeScriptRecord, replacements []pathReplacement) {
	t.Helper()
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(record); err != nil {
		t.Fatal(err)
	}
	text := buffer.String()
	for _, replacement := range replacements {
		text = strings.ReplaceAll(text, replacement.actual, replacement.placeholder)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readTypeScriptRecord(t *testing.T, path string, replacements []pathReplacement) typeScriptRecord {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("typescript record not found: expected %s, actual %v", path, err)
	}
	text := string(content)
	for _, replacement := range replacements {
		text = strings.ReplaceAll(text, replacement.placeholder, replacement.actual)
	}
	var record typeScriptRecord
	if err := json.Unmarshal([]byte(text), &record); err != nil {
		t.Fatalf("decode typescript record %s: %v", path, err)
	}
	return record
}

// ワークスペースでは git の中身と flock の .lock を記録しない
// https://pubs.opengroup.org/onlinepubs/9699919799/functions/flock.html
func skipRootEntry(relative string, isDirectory bool) bool {
	if isDirectory {
		return relative == ".git"
	}
	return strings.HasSuffix(relative, ".lock")
}

// 状態ディレクトリの workspaces.json は、テストが作った全部のワークスペースを並べるので記録しない
func skipStateEntry(relative string, isDirectory bool) bool {
	if isDirectory {
		return false
	}
	return relative == "workspaces.json" || strings.HasSuffix(relative, ".lock")
}

func readRecordedTree(t *testing.T, directory string, skip func(relative string, isDirectory bool) bool) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, relErr := filepath.Rel(directory, path)
		if relErr != nil {
			return relErr
		}
		if relative == "." {
			return nil
		}
		relative = filepath.ToSlash(relative)
		if skip(relative, entry.IsDir()) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		files[relative] = string(content)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

// restoreRecordedTree は記録のファイルを書き、記録に無いファイルを消す
func restoreRecordedTree(t *testing.T, directory string, files map[string]string, skip func(relative string, isDirectory bool) bool) {
	t.Helper()
	for relative := range readRecordedTree(t, directory, skip) {
		if _, recorded := files[relative]; recorded {
			continue
		}
		if err := os.Remove(filepath.Join(directory, filepath.FromSlash(relative))); err != nil {
			t.Fatal(err)
		}
	}
	for relative, content := range files {
		path := filepath.Join(directory, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func copyTree(t *testing.T, from string, to string) {
	t.Helper()
	command := exec.Command("cp", "-a", from+"/.", to)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("cp: %v\n%s", err, output)
	}
}

func snapshotYaru(t *testing.T, root string) map[string]string {
	t.Helper()
	files := map[string]string{}
	directory := filepath.Join(root, ".yaru")
	err := filepath.Walk(directory, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		// .lock は flock の副作用で、TS 版の .yaru には無い。
		// https://pubs.opengroup.org/onlinepubs/9699919799/functions/flock.html
		if strings.HasSuffix(info.Name(), ".lock") {
			return nil
		}
		relative, relErr := filepath.Rel(directory, path)
		if relErr != nil {
			return relErr
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		files[filepath.ToSlash(relative)] = string(data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func assertSameYaru(t *testing.T, left string, right string) {
	t.Helper()
	leftFiles := snapshotYaru(t, left)
	rightFiles := snapshotYaru(t, right)
	if len(leftFiles) != len(rightFiles) {
		t.Fatalf("file count typescript %d go %d\ntypescript %#v\ngo %#v", len(leftFiles), len(rightFiles), keysOf(leftFiles), keysOf(rightFiles))
	}
	for path, content := range leftFiles {
		if rightFiles[path] != content {
			t.Fatalf("%s\n--- typescript\n%s\n--- go\n%s", path, content, rightFiles[path])
		}
	}
}

func keysOf(files map[string]string) []string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	return names
}

func registerWorkspace(t *testing.T, root string, stateDirectory string) string {
	t.Helper()
	registered, err := workspace.RegisterIn(context.Background(), root, stateDirectory)
	if err != nil {
		t.Fatal(err)
	}
	return registered.Slug
}

func newRepository(t *testing.T, stateDirectory string) (string, string) {
	t.Helper()
	root := physicalTemp(t)
	initRepositoryGit(t, root)
	runYaru(t, root, stateDirectory, "init")
	return root, registerWorkspace(t, root, stateDirectory)
}

func duplicateRepository(t *testing.T, source string, stateDirectory string) (string, string) {
	t.Helper()
	root := physicalTemp(t)
	copyTree(t, source, root)
	return root, registerWorkspace(t, root, stateDirectory)
}

func duplicateNamed(t *testing.T, source string, name string, stateDirectory string) (string, string) {
	t.Helper()
	root := namedRoot(t, name)
	copyTree(t, source, root)
	return root, registerWorkspace(t, root, stateDirectory)
}

type apiClients struct {
	question  yaruv1connect.QuestionServiceClient
	dashboard yaruv1connect.DashboardServiceClient
	inbox     yaruv1connect.InboxServiceClient
}

func startAPI(t *testing.T, stateDirectory string) apiClients {
	t.Helper()
	server := httptest.NewServer(Handler(stateDirectory))
	t.Cleanup(server.Close)
	return apiClients{
		question:  yaruv1connect.NewQuestionServiceClient(server.Client(), server.URL),
		dashboard: yaruv1connect.NewDashboardServiceClient(server.Client(), server.URL),
		inbox:     yaruv1connect.NewInboxServiceClient(server.Client(), server.URL),
	}
}

func connectFailure(t *testing.T, err error) *connect.Error {
	t.Helper()
	var connectError *connect.Error
	if !errors.As(err, &connectError) {
		t.Fatalf("got %T %v", err, err)
	}
	return connectError
}

func questionDetail(t *testing.T, err error) *yaruv1.Question {
	t.Helper()
	connectError := connectFailure(t, err)
	details := connectError.Details()
	if len(details) != 1 {
		t.Fatalf("details %d", len(details))
	}
	value, valueErr := details[0].Value()
	if valueErr != nil {
		t.Fatal(valueErr)
	}
	conflict, ok := value.(*yaruv1.QuestionConflict)
	if !ok || conflict.GetQuestion() == nil {
		t.Fatalf("detail %T", value)
	}
	return conflict.GetQuestion()
}

func httpErrorMessage(t *testing.T, payload map[string]any) string {
	t.Helper()
	if location, ok := payload["location"].(string); ok && location != "" {
		request, err := http.NewRequest(http.MethodGet, "http://yaru.invalid"+location, nil)
		if err != nil {
			t.Fatal(err)
		}
		if message := request.URL.Query().Get("error"); message != "" {
			return message
		}
	}
	body, _ := payload["body"].(string)
	var decoded map[string]any
	if err := json.Unmarshal([]byte(body), &decoded); err == nil {
		if message, ok := decoded["error"].(string); ok {
			return message
		}
	}
	t.Fatalf("no error in %#v", payload)
	return ""
}

func TestAnswerMatchesTypeScriptJSONAndForm(t *testing.T) {
	stateDirectory := physicalTemp(t)
	source, _ := newRepository(t, stateDirectory)
	runYaru(t, source, stateDirectory, "question", "save", "--title", "Ship it", "--body", "now?")
	typescriptRoot, _ := duplicateRepository(t, source, stateDirectory)
	goRoot, goSlug := duplicateRepository(t, source, stateDirectory)
	clients := startAPI(t, stateDirectory)
	t.Chdir(goRoot)

	typescript := webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-answer",
		"COMPARE_ID":     "1",
		"COMPARE_SLUG":   "ignored",
		"COMPARE_JSON":   `{"body":"yes","expectedStatus":"open"}`,
	})
	if typescript["status"] != float64(200) {
		t.Fatalf("%#v", typescript)
	}
	response, err := clients.question.AnswerQuestion(context.Background(), connect.NewRequest(&yaruv1.AnswerQuestionRequest{
		Workspace:      goSlug,
		Id:             "1",
		Body:           protoString("yes"),
		ExpectedStatus: protoQuestionStatus(yaruv1.QuestionStatus_QUESTION_STATUS_OPEN),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if response.Msg.GetNow() != fixedNow {
		t.Fatalf("now %s", response.Msg.GetNow())
	}
	if response.Msg.GetQuestion().GetStatus() != yaruv1.QuestionStatus_QUESTION_STATUS_ANSWERED || response.Msg.GetQuestion().GetAnswer() != "yes" {
		t.Fatalf("%#v", response.Msg.GetQuestion())
	}
	assertSameYaru(t, typescriptRoot, goRoot)

	formSource, _ := newRepository(t, stateDirectory)
	runYaru(t, formSource, stateDirectory, "question", "save", "--title", "Ship it", "--default", "wait", "--answerBy", "2h")
	formTypeScript, _ := duplicateRepository(t, formSource, stateDirectory)
	formGo, formSlug := duplicateRepository(t, formSource, stateDirectory)
	t.Chdir(formGo)
	form := webAction(t, formTypeScript, stateDirectory, map[string]string{
		"COMPARE_ACTION": "form-answer",
		"COMPARE_ID":     "1",
		"COMPARE_SLUG":   "app",
		"COMPARE_FORM":   "body=use+this&expectedStatus=open&force=1",
	})
	if form["status"] != float64(303) {
		t.Fatalf("%#v", form)
	}
	forced, err := clients.question.AnswerQuestion(context.Background(), connect.NewRequest(&yaruv1.AnswerQuestionRequest{
		Workspace:      formSlug,
		Id:             "1",
		Body:           protoString("use this"),
		ExpectedStatus: protoQuestionStatus(yaruv1.QuestionStatus_QUESTION_STATUS_OPEN),
		Force:          protoBool(true),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if forced.Msg.GetQuestion().GetAnswer() != "use this" {
		t.Fatal(forced.Msg.GetQuestion().GetAnswer())
	}
	assertSameYaru(t, formTypeScript, formGo)
}

func TestAnswerErrorsMatchTypeScript(t *testing.T) {
	stateDirectory := physicalTemp(t)
	source, _ := newRepository(t, stateDirectory)
	runYaru(t, source, stateDirectory, "question", "save", "--title", "Ship it")
	typescriptRoot, _ := duplicateRepository(t, source, stateDirectory)
	goRoot, slug := duplicateRepository(t, source, stateDirectory)
	clients := startAPI(t, stateDirectory)
	t.Chdir(goRoot)

	emptyTypeScript := webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-answer",
		"COMPARE_ID":     "1",
		"COMPARE_JSON":   `{"body":" "}`,
	})
	_, emptyErr := clients.question.AnswerQuestion(context.Background(), connect.NewRequest(&yaruv1.AnswerQuestionRequest{
		Workspace: slug,
		Id:        "1",
		Body:      protoString(" "),
	}))
	emptyFailure := connectFailure(t, emptyErr)
	if emptyFailure.Code() != connect.CodeInvalidArgument || emptyFailure.Message() != httpErrorMessage(t, emptyTypeScript) {
		t.Fatalf("go %s %s typescript %s", emptyFailure.Code(), emptyFailure.Message(), httpErrorMessage(t, emptyTypeScript))
	}
	assertSameYaru(t, typescriptRoot, goRoot)

	webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-answer",
		"COMPARE_ID":     "1",
		"COMPARE_JSON":   `{"body":"first"}`,
	})
	answered, err := clients.question.AnswerQuestion(context.Background(), connect.NewRequest(&yaruv1.AnswerQuestionRequest{
		Workspace: slug,
		Id:        "1",
		Body:      protoString("first"),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if answered.Msg.GetNow() != clock.ISOString(mustFixedNow(t)) {
		t.Fatal(answered.Msg.GetNow())
	}

	conflictTypeScript := webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-answer",
		"COMPARE_ID":     "1",
		"COMPARE_JSON":   `{"body":"second","expectedStatus":"open"}`,
	})
	_, conflictErr := clients.question.AnswerQuestion(context.Background(), connect.NewRequest(&yaruv1.AnswerQuestionRequest{
		Workspace:      slug,
		Id:             "1",
		Body:           protoString("second"),
		ExpectedStatus: protoQuestionStatus(yaruv1.QuestionStatus_QUESTION_STATUS_OPEN),
	}))
	conflictFailure := connectFailure(t, conflictErr)
	if conflictFailure.Code() != connect.CodeAborted || conflictFailure.Message() != httpErrorMessage(t, conflictTypeScript) {
		t.Fatalf("go %s %s typescript %s", conflictFailure.Code(), conflictFailure.Message(), httpErrorMessage(t, conflictTypeScript))
	}
	if questionDetail(t, conflictErr).GetAnswer() != "first" {
		t.Fatal(questionDetail(t, conflictErr).GetAnswer())
	}
	assertSameYaru(t, typescriptRoot, goRoot)

	_, missingErr := clients.question.GetQuestion(context.Background(), connect.NewRequest(&yaruv1.GetQuestionRequest{
		Workspace: slug,
		Id:        "9",
	}))
	missingTypeScript := webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-get",
		"COMPARE_ID":     "9",
	})
	missingFailure := connectFailure(t, missingErr)
	if missingFailure.Code() != connect.CodeNotFound || missingFailure.Message() != httpErrorMessage(t, missingTypeScript) || len(missingFailure.Details()) != 0 {
		t.Fatalf("%s %s details %d", missingFailure.Code(), missingFailure.Message(), len(missingFailure.Details()))
	}

	_, workspaceErr := clients.question.GetQuestion(context.Background(), connect.NewRequest(&yaruv1.GetQuestionRequest{
		Workspace: "missing",
		Id:        "1",
	}))
	workspaceFailure := connectFailure(t, workspaceErr)
	if workspaceFailure.Code() != connect.CodeNotFound || workspaceFailure.Message() != "workspace not found: missing" {
		t.Fatalf("%s %s", workspaceFailure.Code(), workspaceFailure.Message())
	}

	_, statusErr := clients.question.ListQuestions(context.Background(), connect.NewRequest(&yaruv1.ListQuestionsRequest{
		Workspace: slug,
		Status:    protoQuestionStatus(yaruv1.QuestionStatus(9)),
	}))
	statusFailure := connectFailure(t, statusErr)
	if statusFailure.Code() != connect.CodeInvalidArgument || statusFailure.Message() != "invalid status: expected open, expired, answered, or canceled, actual 9" {
		t.Fatalf("%s %s", statusFailure.Code(), statusFailure.Message())
	}
}

func TestCancelAndUndoMatchTypeScript(t *testing.T) {
	stateDirectory := physicalTemp(t)
	source, _ := newRepository(t, stateDirectory)
	runYaru(t, source, stateDirectory, "question", "save", "--title", "Ship it", "--body", "now?")
	typescriptRoot, _ := duplicateRepository(t, source, stateDirectory)
	goRoot, slug := duplicateRepository(t, source, stateDirectory)
	clients := startAPI(t, stateDirectory)
	t.Chdir(goRoot)

	webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-answer",
		"COMPARE_ID":     "1",
		"COMPARE_JSON":   `{"body":"yes"}`,
	})
	if _, err := clients.question.AnswerQuestion(context.Background(), connect.NewRequest(&yaruv1.AnswerQuestionRequest{
		Workspace: slug,
		Id:        "1",
		Body:      protoString("yes"),
	})); err != nil {
		t.Fatal(err)
	}
	undoTypeScript := webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "form-undo",
		"COMPARE_ID":     "1",
		"COMPARE_FORM":   "answeredAt=" + fixedNow,
	})
	if undoTypeScript["status"] != float64(303) || strings.Contains(strings.ToLower(stringify(undoTypeScript["location"])), "error=") {
		t.Fatalf("undo failed %#v", undoTypeScript)
	}
	undone, err := clients.question.UndoAnswer(context.Background(), connect.NewRequest(&yaruv1.UndoAnswerRequest{
		Workspace:  slug,
		Id:         "1",
		AnsweredAt: protoString(fixedNow),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if undone.Msg.GetQuestion().GetStatus() != yaruv1.QuestionStatus_QUESTION_STATUS_OPEN || undone.Msg.GetNow() != fixedNow {
		t.Fatalf("%s %s", undone.Msg.GetQuestion().GetStatus(), undone.Msg.GetNow())
	}
	assertSameYaru(t, typescriptRoot, goRoot)

	cancelTypeScript := webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-cancel",
		"COMPARE_ID":     "1",
	})
	canceled, err := clients.question.CancelQuestion(context.Background(), connect.NewRequest(&yaruv1.CancelQuestionRequest{
		Workspace: slug,
		Id:        "1",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cancelTypeScript["status"] != float64(200) || canceled.Msg.GetQuestion().GetStatus() != yaruv1.QuestionStatus_QUESTION_STATUS_CANCELED {
		t.Fatalf("typescript %#v go %s", cancelTypeScript, canceled.Msg.GetQuestion().GetStatus())
	}
	before := snapshotYaru(t, goRoot)
	again, err := clients.question.CancelQuestion(context.Background(), connect.NewRequest(&yaruv1.CancelQuestionRequest{
		Workspace: slug,
		Id:        "1",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if again.Msg.GetQuestion().GetStatus() != yaruv1.QuestionStatus_QUESTION_STATUS_CANCELED {
		t.Fatal(again.Msg.GetQuestion().GetStatus())
	}
	after := snapshotYaru(t, goRoot)
	for path, content := range before {
		if after[path] != content {
			t.Fatalf("rewrote %s", path)
		}
	}
	assertSameYaru(t, typescriptRoot, goRoot)

	answeredSource, _ := newRepository(t, stateDirectory)
	runYaru(t, answeredSource, stateDirectory, "question", "save", "--title", "Ship it")
	answeredTypeScript, _ := duplicateRepository(t, answeredSource, stateDirectory)
	answeredGo, answeredSlug := duplicateRepository(t, answeredSource, stateDirectory)
	t.Chdir(answeredGo)
	webAction(t, answeredTypeScript, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-answer",
		"COMPARE_ID":     "1",
		"COMPARE_JSON":   `{"body":"yes"}`,
	})
	if _, err := clients.question.AnswerQuestion(context.Background(), connect.NewRequest(&yaruv1.AnswerQuestionRequest{
		Workspace: answeredSlug,
		Id:        "1",
		Body:      protoString("yes"),
	})); err != nil {
		t.Fatal(err)
	}
	cancelConflictTypeScript := webAction(t, answeredTypeScript, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-cancel",
		"COMPARE_ID":     "1",
	})
	_, cancelErr := clients.question.CancelQuestion(context.Background(), connect.NewRequest(&yaruv1.CancelQuestionRequest{
		Workspace: answeredSlug,
		Id:        "1",
	}))
	cancelFailure := connectFailure(t, cancelErr)
	if cancelFailure.Code() != connect.CodeAborted || cancelFailure.Message() != httpErrorMessage(t, cancelConflictTypeScript) {
		t.Fatalf("%s %s typescript %s", cancelFailure.Code(), cancelFailure.Message(), httpErrorMessage(t, cancelConflictTypeScript))
	}
	if questionDetail(t, cancelErr).GetStatus() != yaruv1.QuestionStatus_QUESTION_STATUS_ANSWERED {
		t.Fatal(questionDetail(t, cancelErr).GetStatus())
	}
	assertSameYaru(t, answeredTypeScript, answeredGo)

	t.Setenv("YARU_NOW", "2026-09-28T12:00:31.000Z")
	timeoutTypeScript := webAction(t, answeredTypeScript, stateDirectory, map[string]string{
		"COMPARE_ACTION": "form-undo",
		"COMPARE_ID":     "1",
		"COMPARE_FORM":   "answeredAt=" + fixedNow,
	})
	_, timeoutErr := clients.question.UndoAnswer(context.Background(), connect.NewRequest(&yaruv1.UndoAnswerRequest{
		Workspace:  answeredSlug,
		Id:         "1",
		AnsweredAt: protoString(fixedNow),
	}))
	timeoutFailure := connectFailure(t, timeoutErr)
	if timeoutFailure.Code() != connect.CodeFailedPrecondition || timeoutFailure.Message() != httpErrorMessage(t, timeoutTypeScript) {
		t.Fatalf("%s %s typescript %s", timeoutFailure.Code(), timeoutFailure.Message(), httpErrorMessage(t, timeoutTypeScript))
	}
	if questionDetail(t, timeoutErr).GetAnswer() != "yes" {
		t.Fatal(questionDetail(t, timeoutErr).GetAnswer())
	}
	assertSameYaru(t, answeredTypeScript, answeredGo)
}

func TestUndoAcknowledgeAndLateAnswerMatchTypeScript(t *testing.T) {
	stateDirectory := physicalTemp(t)
	source, _ := newRepository(t, stateDirectory)
	runYaru(t, source, stateDirectory, "question", "save", "--title", "Ship it")
	typescriptRoot, _ := duplicateRepository(t, source, stateDirectory)
	goRoot, slug := duplicateRepository(t, source, stateDirectory)
	clients := startAPI(t, stateDirectory)
	t.Chdir(goRoot)
	webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-answer",
		"COMPARE_ID":     "1",
		"COMPARE_JSON":   `{"body":"yes"}`,
	})
	if _, err := clients.question.AnswerQuestion(context.Background(), connect.NewRequest(&yaruv1.AnswerQuestionRequest{
		Workspace: slug,
		Id:        "1",
		Body:      protoString("yes"),
	})); err != nil {
		t.Fatal(err)
	}
	webAction(t, typescriptRoot, stateDirectory, map[string]string{"COMPARE_ACTION": "acknowledge", "COMPARE_ID": "1"})
	opened := mustOpen(t, goRoot)
	if _, err := questions.NewService().AcknowledgeQuestion(context.Background(), questions.Directory{Dir: opened.Directory}, "1", mustFixedNow(t)); err != nil {
		t.Fatal(err)
	}
	acknowledgeTypeScript := webAction(t, typescriptRoot, stateDirectory, map[string]string{
		"COMPARE_ACTION": "form-undo",
		"COMPARE_ID":     "1",
		"COMPARE_FORM":   "answeredAt=" + fixedNow,
	})
	_, acknowledgeErr := clients.question.UndoAnswer(context.Background(), connect.NewRequest(&yaruv1.UndoAnswerRequest{
		Workspace:  slug,
		Id:         "1",
		AnsweredAt: protoString(fixedNow),
	}))
	acknowledgeFailure := connectFailure(t, acknowledgeErr)
	if acknowledgeFailure.Code() != connect.CodeFailedPrecondition || acknowledgeFailure.Message() != httpErrorMessage(t, acknowledgeTypeScript) {
		t.Fatalf("%s %s typescript %s", acknowledgeFailure.Code(), acknowledgeFailure.Message(), httpErrorMessage(t, acknowledgeTypeScript))
	}
	assertSameYaru(t, typescriptRoot, goRoot)

	lateSource, _ := newRepository(t, stateDirectory)
	webAction(t, lateSource, stateDirectory, map[string]string{
		"COMPARE_ACTION": "seed-issue",
		"COMPARE_TITLE":  "topic",
		"COMPARE_STATUS": "todo",
	})
	runYaru(t, lateSource, stateDirectory, "question", "save", "--title", "Late", "--issue", "1", "--answerBy", "2020-01-01T00:00:00.000Z")
	lateTypeScript, _ := duplicateRepository(t, lateSource, stateDirectory)
	lateGo, lateSlug := duplicateRepository(t, lateSource, stateDirectory)
	t.Chdir(lateGo)
	webAction(t, lateTypeScript, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-answer",
		"COMPARE_ID":     "1",
		"COMPARE_JSON":   `{"body":"too late"}`,
	})
	if _, err := clients.question.AnswerQuestion(context.Background(), connect.NewRequest(&yaruv1.AnswerQuestionRequest{
		Workspace: lateSlug,
		Id:        "1",
		Body:      protoString("too late"),
	})); err != nil {
		t.Fatal(err)
	}
	assertSameYaru(t, lateTypeScript, lateGo)
	lateUndoTypeScript := webAction(t, lateTypeScript, stateDirectory, map[string]string{
		"COMPARE_ACTION": "form-undo",
		"COMPARE_ID":     "1",
		"COMPARE_FORM":   "answeredAt=" + fixedNow,
	})
	_, lateErr := clients.question.UndoAnswer(context.Background(), connect.NewRequest(&yaruv1.UndoAnswerRequest{
		Workspace:  lateSlug,
		Id:         "1",
		AnsweredAt: protoString(fixedNow),
	}))
	lateFailure := connectFailure(t, lateErr)
	if lateFailure.Code() != connect.CodeFailedPrecondition || lateFailure.Message() != httpErrorMessage(t, lateUndoTypeScript) {
		t.Fatalf("%s %s typescript %s", lateFailure.Code(), lateFailure.Message(), httpErrorMessage(t, lateUndoTypeScript))
	}
	assertSameYaru(t, lateTypeScript, lateGo)
}

func TestListAndGetMatchTypeScript(t *testing.T) {
	stateDirectory := physicalTemp(t)
	root, slug := newRepository(t, stateDirectory)
	runYaru(t, root, stateDirectory, "question", "save", "--title", "Choose", "--priority", "high", "--option", "Yes", "--option", "No", "--body", "Which?")
	if err := os.WriteFile(filepath.Join(root, ".yaru", "questions", "9.md"), []byte("not a question\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	clients := startAPI(t, stateDirectory)
	listedTypeScript := webAction(t, root, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-list",
		"COMPARE_QUERY":  "?status=open",
	})
	listed, err := clients.question.ListQuestions(context.Background(), connect.NewRequest(&yaruv1.ListQuestionsRequest{
		Workspace: slug,
		Status:    protoQuestionStatus(yaruv1.QuestionStatus_QUESTION_STATUS_OPEN),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if listed.Msg.GetNow() != fixedNow {
		t.Fatal(listed.Msg.GetNow())
	}
	body, _ := listedTypeScript["body"].(string)
	var decoded map[string]any
	if err := json.Unmarshal([]byte(body), &decoded); err != nil {
		t.Fatal(err)
	}
	questionsJSON, _ := decoded["questions"].([]any)
	if len(questionsJSON) != 1 || len(listed.Msg.GetQuestions()) != 1 {
		t.Fatalf("typescript %d go %d", len(questionsJSON), len(listed.Msg.GetQuestions()))
	}
	assertQuestionJSON(t, questionsJSON[0].(map[string]any), listed.Msg.GetQuestions()[0])

	gotTypeScript := webAction(t, root, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-get",
		"COMPARE_ID":     "1",
	})
	got, err := clients.question.GetQuestion(context.Background(), connect.NewRequest(&yaruv1.GetQuestionRequest{
		Workspace: slug,
		Id:        "1",
	}))
	if err != nil {
		t.Fatal(err)
	}
	var questionJSON map[string]any
	gotBody, _ := gotTypeScript["body"].(string)
	if err := json.Unmarshal([]byte(gotBody), &questionJSON); err != nil {
		t.Fatal(err)
	}
	assertQuestionJSON(t, questionJSON, got.Msg.GetQuestion())

	broken := webAction(t, root, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-get",
		"COMPARE_ID":     "9",
	})
	_, brokenErr := clients.question.GetQuestion(context.Background(), connect.NewRequest(&yaruv1.GetQuestionRequest{
		Workspace: slug,
		Id:        "9",
	}))
	brokenFailure := connectFailure(t, brokenErr)
	if brokenFailure.Code() != connect.CodeInvalidArgument || brokenFailure.Message() != httpErrorMessage(t, broken) {
		t.Fatalf("%s %s typescript %s", brokenFailure.Code(), brokenFailure.Message(), httpErrorMessage(t, broken))
	}
}

func TestDashboardMatchesTypeScript(t *testing.T) {
	stateDirectory := physicalTemp(t)
	root, slug := newRepository(t, stateDirectory)
	runYaru(t, root, stateDirectory, "question", "save", "--title", "Ship it", "--answerBy", "2020-01-01T00:00:00.000Z")
	webAction(t, root, stateDirectory, map[string]string{
		"COMPARE_ACTION": "seed-issue",
		"COMPARE_TITLE":  "topic",
		"COMPARE_STATUS": "in_progress",
	})
	homeDirectory := physicalTemp(t)
	t.Setenv("HOME", homeDirectory)
	project := sessions.ClaudeProjectDirectory(root, homeDirectory)
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	session := "{\"type\":\"assistant\",\"timestamp\":\"2026-09-28T11:00:00.000Z\",\"message\":{\"id\":\"m1\",\"model\":\"claude-haiku-4-5\",\"usage\":{\"input_tokens\":1000,\"output_tokens\":1000,\"cache_read_input_tokens\":0,\"cache_creation_input_tokens\":0},\"content\":[{\"type\":\"text\",\"text\":\"x\"}]}}\n"
	sessionPath := filepath.Join(project, "s1.jsonl")
	if err := os.WriteFile(sessionPath, []byte(session), 0o644); err != nil {
		t.Fatal(err)
	}
	moment := mustFixedNow(t)
	if err := os.Chtimes(sessionPath, moment, moment); err != nil {
		t.Fatal(err)
	}
	clients := startAPI(t, stateDirectory)
	typescript := webAction(t, root, stateDirectory, map[string]string{"COMPARE_ACTION": "dashboard"})
	response, err := clients.dashboard.GetDashboard(context.Background(), connect.NewRequest(&yaruv1.GetDashboardRequest{Workspace: slug}))
	if err != nil {
		t.Fatal(err)
	}
	if response.Msg.GetNow() != typescript["now"] {
		t.Fatalf("now go %s typescript %v", response.Msg.GetNow(), typescript["now"])
	}
	questionsJSON, _ := typescript["questions"].([]any)
	issuesJSON, _ := typescript["issues"].([]any)
	if len(response.Msg.GetQuestions()) != len(questionsJSON) || len(response.Msg.GetIssues()) != len(issuesJSON) {
		t.Fatalf("questions %d/%d issues %d/%d", len(response.Msg.GetQuestions()), len(questionsJSON), len(response.Msg.GetIssues()), len(issuesJSON))
	}
	assertQuestionJSON(t, questionsJSON[0].(map[string]any), response.Msg.GetQuestions()[0])
	assertIssueJSON(t, issuesJSON[0].(map[string]any), response.Msg.GetIssues()[0])
	sessionHealth, _ := typescript["sessionHealth"].(map[string]any)
	sessionsJSON, _ := sessionHealth["sessions"].([]any)
	if response.Msg.GetSessionHealth().GetWindowDays() != int32(sessionHealth["windowDays"].(float64)) || len(response.Msg.GetSessionHealth().GetSessions()) != len(sessionsJSON) {
		t.Fatalf("health %#v go window %d sessions %d", sessionHealth, response.Msg.GetSessionHealth().GetWindowDays(), len(response.Msg.GetSessionHealth().GetSessions()))
	}
	if len(sessionsJSON) != 1 || response.Msg.GetSessionHealth().GetSessions()[0].GetInputTokens() != sessionsJSON[0].(map[string]any)["inputTokens"].(float64) {
		t.Fatalf("session typescript %#v go %#v", sessionsJSON, response.Msg.GetSessionHealth().GetSessions())
	}
	repositoryJSON, _ := typescript["repository"].(map[string]any)
	if response.Msg.GetRepository().GetBranch() != repositoryJSON["branch"] {
		t.Fatalf("branch go %s typescript %v", response.Msg.GetRepository().GetBranch(), repositoryJSON["branch"])
	}
	if int(response.Msg.GetRepository().GetUncommittedFiles()) != int(repositoryJSON["uncommittedFiles"].(float64)) {
		t.Fatalf("uncommitted go %d typescript %v", response.Msg.GetRepository().GetUncommittedFiles(), repositoryJSON["uncommittedFiles"])
	}
}

func TestInboxMatchesTypeScript(t *testing.T) {
	stateDirectory := physicalTemp(t)
	root := physicalTemp(t)
	initRepositoryGit(t, root)
	runYaru(t, root, stateDirectory, "init")
	registry := "{\n  \"workspaces\": [\n    {\n      \"slug\": \"A B\",\n      \"root\": " + jsonString(root) + "\n    }\n  ]\n}\n"
	if err := os.WriteFile(filepath.Join(stateDirectory, "workspaces.json"), []byte(registry), 0o644); err != nil {
		t.Fatal(err)
	}
	runYaru(t, root, stateDirectory, "question", "save", "--title", "Blocking")
	runYaru(t, root, stateDirectory, "question", "save", "--title", "Soon", "--default", "go", "--answerBy", "2h")
	runYaru(t, root, stateDirectory, "question", "save", "--title", "Whenever", "--default", "go")
	runYaru(t, root, stateDirectory, "question", "save", "--title", "Past", "--default", "go", "--answerBy", "2020-01-01T00:00:00.000Z")
	runYaru(t, root, stateDirectory, "question", "save", "--title", "Done")
	webAction(t, root, stateDirectory, map[string]string{
		"COMPARE_ACTION": "json-answer",
		"COMPARE_ID":     "5",
		"COMPARE_SLUG":   "A B",
		"COMPARE_JSON":   `{"body":"yes"}`,
	})
	typescript := webAction(t, root, stateDirectory, map[string]string{"COMPARE_ACTION": "inbox"})
	if typescript["status"] != float64(200) {
		t.Fatalf("%#v", typescript)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(typescript["body"].(string)), &decoded); err != nil {
		t.Fatal(err)
	}
	clients := startAPI(t, stateDirectory)
	response, err := clients.inbox.GetInbox(context.Background(), connect.NewRequest(&yaruv1.GetInboxRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if response.Msg.GetNow() != fixedNow {
		t.Fatal(response.Msg.GetNow())
	}
	assertInboxGroup(t, decoded, "blocking", response.Msg.GetGroups().GetBlocking(), "1")
	assertInboxGroup(t, decoded, "dueSoon", response.Msg.GetGroups().GetDueSoon(), "2")
	assertInboxGroup(t, decoded, "noDeadline", response.Msg.GetGroups().GetNoDeadline(), "3")
	assertInboxGroup(t, decoded, "proceeded", response.Msg.GetGroups().GetProceeded(), "4")
	if len(response.Msg.GetWorkspaces()) != 1 || response.Msg.GetWorkspaces()[0].GetSlug() != "A B" || response.Msg.GetWorkspaces()[0].GetAwaiting() != 4 {
		t.Fatalf("%#v", response.Msg.GetWorkspaces())
	}
	if response.Msg.GetWorkspaces()[0].GetBasePath() != "/p/A%20B" {
		t.Fatal(response.Msg.GetWorkspaces()[0].GetBasePath())
	}
	item := response.Msg.GetGroups().GetBlocking()[0]
	if item.GetHref() != "/p/A%20B/dashboard#q-1" || item.GetAnchor() != "q-A B-1" || item.GetBasePath() != "/p/A%20B" {
		t.Fatalf("%s %s %s", item.GetHref(), item.GetAnchor(), item.GetBasePath())
	}
}

func TestNotificationsMatchTypeScript(t *testing.T) {
	t.Setenv("YARU_NOW", "2026-09-25T09:00:00.000Z")
	stateDirectory := physicalTemp(t)
	source := namedRoot(t, "app")
	initRepositoryGit(t, source)
	runYaru(t, source, stateDirectory, "init")
	config := "publicUrl: https://mac.example.ts.net/\nnotify: cat >> received.jsonl; echo >> received.jsonl\n"
	if err := os.WriteFile(filepath.Join(source, ".yaru", "config.yml"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	runYaru(t, source, stateDirectory, "question", "save", "--title", "soon", "--default", "x", "--answerBy", "1h")
	typescriptState := physicalTemp(t)
	goState := physicalTemp(t)
	typescriptRoot, _ := duplicateNamed(t, source, "app", typescriptState)
	goRoot, _ := duplicateNamed(t, source, "app", goState)
	t.Setenv("YARU_NOW", "2026-09-25T09:50:00.000Z")
	typescriptWarnings := webAction(t, typescriptRoot, typescriptState, map[string]string{
		"COMPARE_ACTION": "notify-expiring",
		"COMPARE_BASE":   "http://127.0.0.1:47800",
	})
	warnings, err := CheckNotifications(goState, "http://127.0.0.1:47800")
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 || len(typescriptWarnings["warnings"].([]any)) != 0 {
		t.Fatalf("go %#v typescript %#v", warnings, typescriptWarnings)
	}
	typescriptReceived, err := os.ReadFile(filepath.Join(typescriptRoot, "received.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	goReceived, err := os.ReadFile(filepath.Join(goRoot, "received.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if string(typescriptReceived) != string(goReceived) {
		t.Fatalf("stdin\n--- typescript\n%s\n--- go\n%s", typescriptReceived, goReceived)
	}
	if !strings.Contains(string(goReceived), "https://mac.example.ts.net/p/app/dashboard#q-1") {
		t.Fatalf("url %s", goReceived)
	}
	assertSameYaru(t, typescriptRoot, goRoot)
	again, err := CheckNotifications(goState, "http://127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatal(again)
	}
	againReceived, err := os.ReadFile(filepath.Join(goRoot, "received.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if string(againReceived) != string(goReceived) {
		t.Fatal("notified twice")
	}

	t.Setenv("YARU_NOW", "2026-09-25T09:00:00.000Z")
	staleState := physicalTemp(t)
	staleSource := namedRoot(t, "stale")
	initRepositoryGit(t, staleSource)
	runYaru(t, staleSource, staleState, "init")
	staleConfig := "staleAfter: 1h\nnotify: cat >> received.jsonl; echo >> received.jsonl\n"
	if err := os.WriteFile(filepath.Join(staleSource, ".yaru", "config.yml"), []byte(staleConfig), 0o644); err != nil {
		t.Fatal(err)
	}
	webAction(t, staleSource, staleState, map[string]string{
		"COMPARE_ACTION": "seed-issue",
		"COMPARE_TITLE":  "stuck",
		"COMPARE_STATUS": "in_progress",
	})
	staleTypeScriptState := physicalTemp(t)
	staleGoState := physicalTemp(t)
	staleTypeScript, _ := duplicateNamed(t, staleSource, "stale", staleTypeScriptState)
	staleGo, _ := duplicateNamed(t, staleSource, "stale", staleGoState)
	t.Setenv("YARU_NOW", "2026-09-25T12:00:00.000Z")
	if _, err := CheckNotifications(staleGoState, "http://127.0.0.1:47800"); err != nil {
		t.Fatal(err)
	}
	webAction(t, staleTypeScript, staleTypeScriptState, map[string]string{
		"COMPARE_ACTION": "notify-stale",
		"COMPARE_BASE":   "http://127.0.0.1:47800",
	})
	goStale, err := os.ReadFile(filepath.Join(staleGoState, "notified-stale-issues.json"))
	if err != nil {
		t.Fatal(err)
	}
	typescriptStale, err := os.ReadFile(filepath.Join(staleTypeScriptState, "notified-stale-issues.json"))
	if err != nil {
		t.Fatal(err)
	}
	if normalizeRoot(string(goStale), staleGo) != normalizeRoot(string(typescriptStale), staleTypeScript) {
		t.Fatalf("stale file\n--- typescript\n%s\n--- go\n%s", typescriptStale, goStale)
	}
	goIssue, err := os.ReadFile(filepath.Join(staleGo, "received.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	typescriptIssue, err := os.ReadFile(filepath.Join(staleTypeScript, "received.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if string(goIssue) != string(typescriptIssue) {
		t.Fatalf("issue stdin\n--- typescript\n%s\n--- go\n%s", typescriptIssue, goIssue)
	}
}

func TestNotifyEnvironmentIsAllowlisted(t *testing.T) {
	saved := map[string]string{}
	for _, name := range []string{"LANG", "LC_ALL", "LC_CTYPE"} {
		value, present := os.LookupEnv(name)
		if present {
			saved[name] = value
		}
		if err := os.Unsetenv(name); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, name := range []string{"LANG", "LC_ALL", "LC_CTYPE"} {
			var restoreErr error
			if value, ok := saved[name]; ok {
				restoreErr = os.Setenv(name, value)
			} else {
				restoreErr = os.Unsetenv(name)
			}
			if restoreErr != nil {
				t.Errorf("restore %s: %v", name, restoreErr)
			}
		}
	})
	t.Setenv("APP_TOKEN", "secret")
	t.Setenv("YARU_STATE_DIR", physicalTemp(t))
	t.Setenv("HERDR_SESSION", "x")
	t.Setenv("TMUX", "1")
	t.Setenv("TMUX_PANE", "%0")
	t.Setenv("YARU_NOW", "2026-09-25T09:00:00.000Z")
	stateDirectory := physicalTemp(t)
	root, slug := newRepository(t, stateDirectory)
	if err := os.WriteFile(filepath.Join(root, ".yaru", "config.yml"), []byte("notify: env > notify-env.txt\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runYaru(t, root, stateDirectory, "question", "save", "--title", "soon", "--default", "x", "--answerBy", "1h")
	parentPath := os.Getenv("PATH")
	t.Setenv("YARU_NOW", "2026-09-25T09:50:00.000Z")
	warnings, err := CheckNotifications(stateDirectory, "http://127.0.0.1:47800")
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatal(warnings)
	}
	environment, err := os.ReadFile(filepath.Join(root, "notify-env.txt"))
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(environment), "\n") {
		if line == "" {
			continue
		}
		name, value, _ := strings.Cut(line, "=")
		values[name] = value
	}
	for _, name := range []string{"APP_TOKEN", "YARU_STATE_DIR", "YARU_NOW", "HERDR_SESSION", "TMUX", "TMUX_PANE"} {
		if _, found := values[name]; found {
			t.Fatalf("passed %s", name)
		}
	}
	if values["PATH"] == parentPath || values["PATH"] != notifyPath() || strings.Contains(values["PATH"], "/evil") {
		t.Fatalf("PATH %s", values["PATH"])
	}
	if values["LANG"] != "en_US.UTF-8" {
		t.Fatalf("LANG %s", values["LANG"])
	}
	if values["YARU_EVENT"] != "question.expiring" || values["YARU_QUESTION_ID"] != "1" || values["YARU_QUESTION_TITLE"] != "soon" {
		t.Fatalf("%#v", values)
	}
	if !strings.Contains(values["YARU_URL"], "/p/"+slug+"/dashboard#q-1") {
		t.Fatal(values["YARU_URL"])
	}
	if _, err := os.ReadFile(filepath.Join(root, "notify-env.txt")); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(root, "notify-env.txt"))
	if err != nil {
		t.Fatal(err)
	}
	_ = info
	opened := mustOpen(t, root)
	warning, err := Notify(opened, Event{
		Name: "question.created",
		URL:  QuestionURL("http://127.0.0.1:47800", slug, "1"),
		Question: &questions.Question{
			ID:    "1",
			Title: "soon",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if warning != "" {
		t.Fatal(warning)
	}
}

func TestNotifyFailureWarningMatchesTypeScript(t *testing.T) {
	t.Setenv("YARU_NOW", "2026-09-25T09:00:00.000Z")
	stateDirectory := physicalTemp(t)
	source := namedRoot(t, "broken")
	initRepositoryGit(t, source)
	runYaru(t, source, stateDirectory, "init")
	if err := os.WriteFile(filepath.Join(source, ".yaru", "config.yml"), []byte("notify: echo boom >&2; exit 3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runYaru(t, source, stateDirectory, "question", "save", "--title", "soon", "--default", "x", "--answerBy", "1h")
	typescriptState := physicalTemp(t)
	goState := physicalTemp(t)
	typescriptRoot, _ := duplicateNamed(t, source, "broken", typescriptState)
	_, _ = duplicateNamed(t, source, "broken", goState)
	t.Setenv("YARU_NOW", "2026-09-25T09:50:00.000Z")
	typescriptWarnings := webAction(t, typescriptRoot, typescriptState, map[string]string{
		"COMPARE_ACTION": "notify-expiring",
		"COMPARE_BASE":   "http://x",
	})
	warnings, err := CheckNotifications(goState, "http://x")
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(warnings, "\n")
	wantList, _ := typescriptWarnings["warnings"].([]any)
	want := make([]string, 0, len(wantList))
	for _, warning := range wantList {
		text, _ := warning.(string)
		want = append(want, text)
	}
	if got != strings.Join(want, "\n") {
		t.Fatalf("go %q typescript %q", got, strings.Join(want, "\n"))
	}
}

func TestWatchNotificationsSkipsWhileRunning(t *testing.T) {
	t.Setenv("YARU_NOW", "2026-09-25T09:00:00.000Z")
	stateDirectory := physicalTemp(t)
	root, _ := newRepository(t, stateDirectory)
	runYaru(t, root, stateDirectory, "question", "save", "--title", "soon", "--default", "x", "--answerBy", "1h")
	command := "echo once >> received.jsonl; sleep 0.4"
	if err := os.WriteFile(filepath.Join(root, ".yaru", "config.yml"), []byte("notify: "+command+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YARU_NOW", "2026-09-25T09:50:00.000Z")
	stop := watchNotifications(stateDirectory, "http://127.0.0.1:47800", func(string) {}, 20*time.Millisecond)
	time.Sleep(200 * time.Millisecond)
	stop()
	time.Sleep(500 * time.Millisecond)
	received, err := os.ReadFile(filepath.Join(root, "received.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(received), "once") != 1 {
		t.Fatalf("received %q", received)
	}
}

func assertInboxGroup(t *testing.T, payload map[string]any, name string, items []*yaruv1.InboxItem, id string) {
	t.Helper()
	groups, _ := payload["groups"].(map[string]any)
	list, _ := groups[name].([]any)
	if len(list) != 1 || len(items) != 1 || items[0].GetQuestion().GetId() != id {
		t.Fatalf("%s typescript %#v go %d", name, list, len(items))
	}
	question, _ := list[0].(map[string]any)["question"].(map[string]any)
	assertQuestionJSON(t, question, items[0].GetQuestion())
}

func assertQuestionJSON(t *testing.T, payload map[string]any, question *yaruv1.Question) {
	t.Helper()
	if question.GetId() != payload["id"] || question.GetTitle() != payload["title"] || question.GetBody() != payload["body"] || question.GetAuthor() != payload["author"] {
		t.Fatalf("identity go %#v json %#v", question, payload)
	}
	if questionStatusName(question.GetStatus()) != payload["status"] {
		t.Fatalf("status go %s json %v", question.GetStatus(), payload["status"])
	}
	assertOptionalString(t, "issue", question.Issue, payload["issue"])
	assertOptionalString(t, "answer", question.Answer, payload["answer"])
	assertOptionalString(t, "answerBy", question.AnswerBy, payload["answerBy"])
	assertOptionalString(t, "defaultAction", question.DefaultAction, payload["defaultAction"])
	if payload["priority"] == nil {
		if question.Priority != nil {
			t.Fatalf("priority %s", question.GetPriority())
		}
	} else if priorityText(question.GetPriority()) != payload["priority"] {
		t.Fatalf("priority go %s json %v", question.GetPriority(), payload["priority"])
	}
	options, _ := payload["options"].([]any)
	if len(options) != len(question.GetOptions()) {
		t.Fatalf("options %#v %#v", options, question.GetOptions())
	}
	for index, option := range options {
		if question.GetOptions()[index] != option {
			t.Fatalf("option %d %v %s", index, option, question.GetOptions()[index])
		}
	}
}

func assertIssueJSON(t *testing.T, payload map[string]any, issue *yaruv1.Issue) {
	t.Helper()
	if issue.GetId() != payload["id"] || issue.GetTitle() != payload["title"] || issue.GetBody() != payload["body"] {
		t.Fatalf("issue %#v %#v", issue, payload)
	}
	if issueStatusName(issue.GetStatus()) != payload["status"] {
		t.Fatalf("status %s %v", issue.GetStatus(), payload["status"])
	}
	if issue.GetStale() != payload["stale"] {
		t.Fatalf("stale %v %v", issue.GetStale(), payload["stale"])
	}
}

func assertOptionalString(t *testing.T, name string, got *string, jsonValue any) {
	t.Helper()
	if jsonValue == nil {
		if got != nil {
			t.Fatalf("%s %q", name, *got)
		}
		return
	}
	text, ok := jsonValue.(string)
	if !ok || got == nil || *got != text {
		t.Fatalf("%s go %#v json %#v", name, got, jsonValue)
	}
}

func questionStatusName(status yaruv1.QuestionStatus) string {
	switch status {
	case yaruv1.QuestionStatus_QUESTION_STATUS_OPEN:
		return "open"
	case yaruv1.QuestionStatus_QUESTION_STATUS_EXPIRED:
		return "expired"
	case yaruv1.QuestionStatus_QUESTION_STATUS_ANSWERED:
		return "answered"
	case yaruv1.QuestionStatus_QUESTION_STATUS_CANCELED:
		return "canceled"
	default:
		return ""
	}
}

func priorityText(priority yaruv1.IssuePriority) string {
	switch priority {
	case yaruv1.IssuePriority_ISSUE_PRIORITY_URGENT:
		return "urgent"
	case yaruv1.IssuePriority_ISSUE_PRIORITY_HIGH:
		return "high"
	case yaruv1.IssuePriority_ISSUE_PRIORITY_MEDIUM:
		return "medium"
	case yaruv1.IssuePriority_ISSUE_PRIORITY_LOW:
		return "low"
	default:
		return ""
	}
}

func issueStatusName(status yaruv1.IssueStatus) string {
	switch status {
	case yaruv1.IssueStatus_ISSUE_STATUS_BACKLOG:
		return "backlog"
	case yaruv1.IssueStatus_ISSUE_STATUS_TODO:
		return "todo"
	case yaruv1.IssueStatus_ISSUE_STATUS_IN_PROGRESS:
		return "in_progress"
	case yaruv1.IssueStatus_ISSUE_STATUS_DONE:
		return "done"
	case yaruv1.IssueStatus_ISSUE_STATUS_CANCELED:
		return "canceled"
	default:
		return ""
	}
}

func protoString(value string) *string { return &value }

func protoBool(value bool) *bool { return &value }

func protoQuestionStatus(status yaruv1.QuestionStatus) *yaruv1.QuestionStatus { return &status }

func mustFixedNow(t *testing.T) time.Time {
	t.Helper()
	moment, _, err := readNow()
	if err != nil {
		t.Fatal(err)
	}
	return moment
}

func mustOpen(t *testing.T, root string) workspace.Workspace {
	t.Helper()
	opened, err := workspace.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	return opened
}

func jsonString(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func stringify(value any) string {
	text, _ := value.(string)
	return text
}

func normalizeRoot(content string, root string) string {
	return strings.ReplaceAll(content, root, "/workspace")
}
