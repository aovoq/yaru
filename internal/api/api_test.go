package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"connectrpc.com/connect"

	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
	"github.com/aovoq/yaru/internal/workspace"
)

// 時刻は docs/spec/yaru-format.md の「時刻」。この文字列は toISOString と同じ。
const fixedNow = "2026-09-28T12:00:00.000Z"

func TestIssueCreateMatchesSpecBytes(t *testing.T) {
	_, slug := newAPIWorkspace(t)
	client := issueClient(t)

	title := "Hello"
	saved, err := client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace:  slug,
		Title:      &title,
		BodyChange: &yaruv1.SaveIssueRequest_Body{Body: "line\n"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if saved.Msg.GetNow() != fixedNow {
		t.Fatalf("now: got %q", saved.Msg.GetNow())
	}
	if saved.Msg.GetIssue().GetId() != "1" || saved.Msg.GetIssue().GetTitle() != "Hello" {
		t.Fatalf("issue: %+v", saved.Msg.GetIssue())
	}
	if saved.Msg.GetIssue().GetAssignee() != "" || saved.Msg.GetIssue().Assignee != nil {
		t.Fatalf("assignee should be unset, got %q", saved.Msg.GetIssue().GetAssignee())
	}
	if len(saved.Msg.GetIssue().GetLabels()) != 0 {
		t.Fatalf("labels: %#v", saved.Msg.GetIssue().GetLabels())
	}

	issuePath := filepath.Join(workspaceRoot(t, slug), ".yaru", "issues", "1.md")
	expectFile(t, issuePath, ""+
		"---\n"+
		"id: 1\n"+
		"title: Hello\n"+
		"status: todo\n"+
		"assignee:\n"+
		"labels:\n"+
		"dueDate:\n"+
		"priority:\n"+
		"parent:\n"+
		"blocks:\n"+
		"startedAt:\n"+
		"completedAt:\n"+
		"canceledAt:\n"+
		"createdAt: 2026-09-28T12:00:00.000Z\n"+
		"updatedAt: 2026-09-28T12:00:00.000Z\n"+
		"session:\n"+
		"worktree:\n"+
		"branch:\n"+
		"---\n"+
		"\n"+
		"line\n"+
		"\n")
}

func TestIssueUpdateWritesEventAndKeepsOmittedFields(t *testing.T) {
	_, slug := newAPIWorkspace(t)
	client := issueClient(t)
	title := "Hello"
	if _, err := client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace:  slug,
		Title:      &title,
		BodyChange: &yaruv1.SaveIssueRequest_Body{Body: "line\n"},
	})); err != nil {
		t.Fatal(err)
	}
	next := "Next"
	id := "1"
	updated, err := client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace: slug,
		Id:        &id,
		Title:     &next,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if updated.Msg.GetIssue().GetBody() != "line\n" || updated.Msg.GetIssue().GetTitle() != "Next" {
		t.Fatalf("partial update: %+v", updated.Msg.GetIssue())
	}
	expectFile(t, filepath.Join(workspaceRoot(t, slug), ".yaru", "events", "1.jsonl"),
		"{\"field\":\"title\",\"from\":\"Hello\",\"to\":\"Next\",\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-28T12:00:00.000Z\"}\n")
}

func TestIssueErrorsMatchTypeScript(t *testing.T) {
	_, slug := newAPIWorkspace(t)
	client := issueClient(t)
	title := "Hello"
	if _, err := client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace: slug,
		Title:     &title,
	})); err != nil {
		t.Fatal(err)
	}

	_, err := client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{Workspace: slug}))
	expectConnect(t, err, connect.CodeInvalidArgument, "title is required when creating an issue")

	_, err = client.GetIssue(context.Background(), connect.NewRequest(&yaruv1.GetIssueRequest{Workspace: slug, Id: "9"}))
	expectConnect(t, err, connect.CodeNotFound, "issue not found: 9")

	missing := "9"
	_, err = client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{Workspace: slug, Id: &missing, Title: &title}))
	expectConnect(t, err, connect.CodeNotFound, "issue not found: 9")

	due := "nope"
	id := "1"
	_, err = client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{Workspace: slug, Id: &id, DueDate: &due}))
	expectConnect(t, err, connect.CodeInvalidArgument, "invalid dueDate: expected YYYY-MM-DD, actual nope")

	unspecified := yaruv1.IssueStatus_ISSUE_STATUS_UNSPECIFIED
	_, err = client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{Workspace: slug, Id: &id, Status: &unspecified}))
	expectConnect(t, err, connect.CodeInvalidArgument, "invalid status: expected backlog, todo, in_progress, done, or canceled, actual ISSUE_STATUS_UNSPECIFIED")

	parent := "9"
	_, err = client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{Workspace: slug, Id: &id, Parent: &parent}))
	expectConnect(t, err, connect.CodeNotFound, "invalid parent: issue not found: 9")

	_, err = client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace:  slug,
		BodyChange: &yaruv1.SaveIssueRequest_Patch{Patch: &yaruv1.PatchList{Operations: []*yaruv1.PatchOperation{{Kind: yaruv1.PatchOpKind_PATCH_OP_KIND_APPEND, Text: pointerTo("x")}}}},
	}))
	expectConnect(t, err, connect.CodeInvalidArgument, "patch is only valid when updating an existing issue")

	broken := filepath.Join(workspaceRoot(t, slug), ".yaru", "issues", "2.md")
	if writeErr := os.WriteFile(broken, []byte("not frontmatter\n"), 0o644); writeErr != nil {
		t.Fatal(writeErr)
	}
	_, err = client.GetIssue(context.Background(), connect.NewRequest(&yaruv1.GetIssueRequest{Workspace: slug, Id: "2"}))
	expectConnect(t, err, connect.CodeInvalidArgument, "invalid issue file")

	listed, err := client.ListIssues(context.Background(), connect.NewRequest(&yaruv1.ListIssuesRequest{Workspace: slug}))
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Msg.GetIssues()) != 1 || listed.Msg.GetIssues()[0].GetId() != "1" {
		t.Fatalf("broken file should be skipped, got %#v", listed.Msg.GetIssues())
	}
	if listed.Msg.GetNow() != fixedNow {
		t.Fatalf("list now: %q", listed.Msg.GetNow())
	}

	_, err = client.GetIssue(context.Background(), connect.NewRequest(&yaruv1.GetIssueRequest{Workspace: "missing", Id: "1"}))
	expectConnect(t, err, connect.CodeNotFound, "workspace not found: missing")
}

func TestIssueClearsAssigneePriorityAndLabels(t *testing.T) {
	_, slug := newAPIWorkspace(t)
	client := issueClient(t)
	title := "Hello"
	assignee := "me"
	priority := yaruv1.IssuePriority_ISSUE_PRIORITY_HIGH
	if _, err := client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace: slug,
		Title:     &title,
		Assignee:  &assignee,
		Labels:    &yaruv1.StringList{Values: []string{"ui"}},
		Priority:  &yaruv1.IssuePriorityUpdate{Priority: priority},
	})); err != nil {
		t.Fatal(err)
	}
	id := "1"
	cleared := ""
	clearedPriority := yaruv1.IssuePriority_ISSUE_PRIORITY_UNSPECIFIED
	saved, err := client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace: slug,
		Id:        &id,
		Assignee:  &cleared,
		Labels:    &yaruv1.StringList{},
		Priority:  &yaruv1.IssuePriorityUpdate{Priority: clearedPriority},
	}))
	if err != nil {
		t.Fatal(err)
	}
	issue := saved.Msg.GetIssue()
	if issue.Assignee != nil || issue.Priority != nil || len(issue.GetLabels()) != 0 {
		t.Fatalf("cleared: assignee=%v priority=%v labels=%#v", issue.Assignee, issue.Priority, issue.GetLabels())
	}
	text := readText(t, filepath.Join(workspaceRoot(t, slug), ".yaru", "issues", "1.md"))
	if !strings.Contains(text, "assignee:\n") || !strings.Contains(text, "priority:\n") || !strings.Contains(text, "labels:\n") {
		t.Fatalf("file:\n%s", text)
	}
}

func TestCommentRoundTripAndErrors(t *testing.T) {
	_, slug := newAPIWorkspace(t)
	issueClient := issueClient(t)
	title := "Hello"
	if _, err := issueClient.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{Workspace: slug, Title: &title})); err != nil {
		t.Fatal(err)
	}
	comments := commentClient(t)
	issueID := "1"
	body := "note"
	saved, err := comments.SaveComment(context.Background(), connect.NewRequest(&yaruv1.SaveCommentRequest{
		Workspace: slug,
		Issue:     &issueID,
		Body:      &body,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if saved.Msg.GetComment().GetAuthor() != "Spec Author" || saved.Msg.GetComment().GetId() != "1" {
		t.Fatalf("comment: %+v", saved.Msg.GetComment())
	}
	expectFile(t, filepath.Join(workspaceRoot(t, slug), ".yaru", "comments", "1.md"), ""+
		"---\n"+
		"id: 1\n"+
		"issue: 1\n"+
		"parent:\n"+
		"author: Spec Author\n"+
		"createdAt: 2026-09-28T12:00:00.000Z\n"+
		"updatedAt: 2026-09-28T12:00:00.000Z\n"+
		"---\n"+
		"\n"+
		"note\n")

	listed, err := comments.ListComments(context.Background(), connect.NewRequest(&yaruv1.ListCommentsRequest{Workspace: slug, Issue: "1"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Msg.GetComments()) != 1 || listed.Msg.GetComments()[0].GetBody() != "note" {
		t.Fatalf("list: %+v", listed.Msg.GetComments())
	}

	_, err = comments.ListComments(context.Background(), connect.NewRequest(&yaruv1.ListCommentsRequest{Workspace: slug}))
	expectConnect(t, err, connect.CodeInvalidArgument, "issue is required when listing comments")

	blank := "  "
	_, err = comments.SaveComment(context.Background(), connect.NewRequest(&yaruv1.SaveCommentRequest{Workspace: slug, Issue: &issueID, Body: &blank}))
	expectConnect(t, err, connect.CodeInvalidArgument, "invalid body: expected a non-empty string, actual \"  \"")

	_, err = comments.ListComments(context.Background(), connect.NewRequest(&yaruv1.ListCommentsRequest{Workspace: slug, Issue: "9"}))
	expectConnect(t, err, connect.CodeNotFound, "issue not found: 9")
}

func TestGetPageMatchesTypeScriptBoard(t *testing.T) {
	root, slug := newAPIWorkspace(t)
	issues := issueClient(t)
	title := "Hello"
	if _, err := issues.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace:  slug,
		Title:      &title,
		BodyChange: &yaruv1.SaveIssueRequest_Body{Body: "line\n"},
	})); err != nil {
		t.Fatal(err)
	}
	next := "Next"
	id := "1"
	if _, err := issues.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{Workspace: slug, Id: &id, Title: &next})); err != nil {
		t.Fatal(err)
	}
	comments := commentClient(t)
	body := "note"
	if _, err := comments.SaveComment(context.Background(), connect.NewRequest(&yaruv1.SaveCommentRequest{Workspace: slug, Issue: &id, Body: &body})); err != nil {
		t.Fatal(err)
	}
	writeQuestion(t, root)

	pages := pageClient(t)
	pageID := "1"
	formError := "from form"
	page, err := pages.GetPage(context.Background(), connect.NewRequest(&yaruv1.GetPageRequest{
		Workspace: slug,
		Id:        &pageID,
		Error:     &formError,
	}))
	if err != nil {
		t.Fatal(err)
	}
	response := page.Msg
	if response.GetNow() != fixedNow {
		t.Fatalf("now: %q", response.GetNow())
	}
	if response.GetBasePath() != "/p/"+slug || response.GetViewer() != "Spec Author" || response.GetView() != yaruv1.IssueView_ISSUE_VIEW_LIST {
		t.Fatalf("page chrome: base=%q viewer=%q view=%s", response.GetBasePath(), response.GetViewer(), response.GetView())
	}
	if response.GetDisplay().GetSort() != yaruv1.IssueSort_ISSUE_SORT_PRIORITY || response.GetDisplay().GetCompleted() != yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_RECENT {
		t.Fatalf("display: %+v", response.GetDisplay())
	}
	if response.GetCurrent().GetTitle() != "Next" || len(response.GetComments()) != 1 || response.GetComments()[0].GetBody() != "note" {
		t.Fatalf("current/comments: %+v %+v", response.GetCurrent(), response.GetComments())
	}
	if len(response.GetEvents()) != 1 || response.GetEvents()[0].GetFromText() != "Hello" || response.GetEvents()[0].GetToText() != "Next" {
		t.Fatalf("events: %+v", response.GetEvents())
	}
	if response.GetError() != "from form" {
		t.Fatalf("error: %q", response.GetError())
	}
	if len(response.GetQuestions()) != 1 || response.GetAwaitingQuestionCount() != 1 {
		t.Fatalf("questions: %d count %d", len(response.GetQuestions()), response.GetAwaitingQuestionCount())
	}
	summary := response.GetAwaitingByIssue()["1"]
	if summary == nil || summary.GetCount() != 1 || summary.GetSoonestAnswerBy() != "2026-09-28T18:00:00.000Z" {
		t.Fatalf("awaiting: %+v", response.GetAwaitingByIssue())
	}
	if len(response.GetCommits()) != 0 {
		t.Fatalf("commits: %+v", response.GetCommits())
	}

	missing := "missing"
	missingPage, err := pages.GetPage(context.Background(), connect.NewRequest(&yaruv1.GetPageRequest{Workspace: slug, Id: &missing}))
	if err != nil {
		t.Fatal(err)
	}
	if missingPage.Msg.GetCurrent() != nil || missingPage.Msg.GetError() != "issue not found: missing" {
		t.Fatalf("missing page: current=%v error=%q", missingPage.Msg.GetCurrent(), missingPage.Msg.GetError())
	}

	newID := "new"
	newStatus := yaruv1.IssueStatus_ISSUE_STATUS_IN_PROGRESS
	newLabel := "ui"
	newAssignee := "me"
	newParent := "1"
	draft, err := pages.GetPage(context.Background(), connect.NewRequest(&yaruv1.GetPageRequest{
		Workspace:   slug,
		Id:          &newID,
		NewStatus:   &newStatus,
		NewLabel:    &newLabel,
		NewAssignee: &newAssignee,
		NewParent:   &newParent,
	}))
	if err != nil {
		t.Fatal(err)
	}
	current := draft.Msg.GetCurrent()
	if current.GetId() != "" || current.GetStatus() != yaruv1.IssueStatus_ISSUE_STATUS_IN_PROGRESS || current.GetAssignee() != "Spec Author" || current.GetParent() != "1" {
		t.Fatalf("draft: %+v", current)
	}
	if len(current.GetLabels()) != 1 || current.GetLabels()[0] != "ui" {
		t.Fatalf("draft labels: %#v", current.GetLabels())
	}

	done := yaruv1.IssueStatus_ISSUE_STATUS_DONE
	hide := yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_HIDE
	filtered, err := pages.GetPage(context.Background(), connect.NewRequest(&yaruv1.GetPageRequest{
		Workspace: slug,
		Status:    &done,
		Completed: &hide,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Msg.GetDisplay().GetCompleted() != yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_ALL {
		t.Fatalf("done column should show all, got %s", filtered.Msg.GetDisplay().GetCompleted())
	}
}

func TestListProjectsSkipsMissingConfig(t *testing.T) {
	home := t.TempDir()
	state := filepath.Join(home, "state")
	prepareEnvironment(t, home, state)
	firstRoot := filepath.Join(home, "alpha")
	secondRoot := filepath.Join(home, "beta")
	if err := os.MkdirAll(firstRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(secondRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Chdir(firstRoot)
	initGit(t, firstRoot)
	if _, err := workspace.Init(firstRoot); err != nil {
		t.Fatal(err)
	}
	initGit(t, secondRoot)
	if _, err := workspace.Init(secondRoot); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.RegisterIn(firstRoot, state); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.RegisterIn(secondRoot, state); err != nil {
		t.Fatal(err)
	}
	issues := issueClient(t)
	title := "Doing"
	status := yaruv1.IssueStatus_ISSUE_STATUS_IN_PROGRESS
	if _, err := issues.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace: "alpha",
		Title:     &title,
		Status:    &status,
	})); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(secondRoot, ".yaru", "config.yml")); err != nil {
		t.Fatal(err)
	}
	projects := projectClient(t)
	listed, err := projects.ListProjects(context.Background(), connect.NewRequest(&yaruv1.ListProjectsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if listed.Msg.GetNow() != fixedNow {
		t.Fatalf("now: %q", listed.Msg.GetNow())
	}
	if len(listed.Msg.GetProjects()) != 1 || listed.Msg.GetProjects()[0].GetSlug() != "alpha" || listed.Msg.GetProjects()[0].GetInProgress() != 1 {
		t.Fatalf("projects: %+v", listed.Msg.GetProjects())
	}
	if listed.Msg.GetProjects()[0].GetRoot() != firstRoot {
		t.Fatalf("root: %q", listed.Msg.GetProjects()[0].GetRoot())
	}
}

func TestHandlerRejectsMethodAndContentType(t *testing.T) {
	server := testServer(t)
	getResponse, err := http.Get(server.URL + yaruv1connect.IssueServiceListIssuesProcedure)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(getResponse.Body)
	_ = getResponse.Body.Close()
	if getResponse.StatusCode != http.StatusMethodNotAllowed || string(body) != "rejected method: expected POST, actual GET" {
		t.Fatalf("GET: %d %q", getResponse.StatusCode, body)
	}

	request, err := http.NewRequest(http.MethodPost, server.URL+yaruv1connect.IssueServiceListIssuesProcedure, strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/grpc")
	postResponse, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(postResponse.Body)
	_ = postResponse.Body.Close()
	if postResponse.StatusCode != http.StatusUnsupportedMediaType || !strings.Contains(string(body), "actual application/grpc") {
		t.Fatalf("grpc: %d %q", postResponse.StatusCode, body)
	}
}

func TestPatchAndSelfBlock(t *testing.T) {
	_, slug := newAPIWorkspace(t)
	client := issueClient(t)
	title := "Hello"
	if _, err := client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace:  slug,
		Title:      &title,
		BodyChange: &yaruv1.SaveIssueRequest_Body{Body: "line"},
	})); err != nil {
		t.Fatal(err)
	}
	id := "1"
	text := "!"
	patched, err := client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace: slug,
		Id:        &id,
		BodyChange: &yaruv1.SaveIssueRequest_Patch{Patch: &yaruv1.PatchList{Operations: []*yaruv1.PatchOperation{{
			Kind: yaruv1.PatchOpKind_PATCH_OP_KIND_APPEND,
			Text: &text,
		}}}},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if patched.Msg.GetIssue().GetBody() != "line!" {
		t.Fatalf("patched body: %q", patched.Msg.GetIssue().GetBody())
	}
	_, err = client.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace:    slug,
		Id:           &id,
		BlocksChange: &yaruv1.SaveIssueRequest_Blocks{Blocks: &yaruv1.StringList{Values: []string{"1"}}},
	}))
	expectConnect(t, err, connect.CodeInvalidArgument, "invalid block: an issue cannot block itself, actual 1")
}

func TestJSONKeepsEmptyLabels(t *testing.T) {
	_, slug := newAPIWorkspace(t)
	server := testServer(t)
	request, err := http.NewRequest(http.MethodPost, server.URL+yaruv1connect.IssueServiceSaveIssueProcedure, strings.NewReader(`{"workspace":"`+slug+`","title":"Hello"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Connect-Protocol-Version", "1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), `"labels":[]`) {
		t.Fatalf("json: %d %s", response.StatusCode, body)
	}
}

func TestMatchesTypeScriptFiles(t *testing.T) {
	home := t.TempDir()
	state := filepath.Join(home, "state")
	goRoot := filepath.Join(home, "go-app")
	tsRoot := filepath.Join(home, "ts-app")
	prepareEnvironment(t, home, state)
	for _, root := range []string{goRoot, tsRoot} {
		if err := os.MkdirAll(root, 0o755); err != nil {
			t.Fatal(err)
		}
		initGit(t, root)
		if _, err := workspace.Init(root); err != nil {
			t.Fatal(err)
		}
	}
	t.Chdir(goRoot)
	registered, err := workspace.RegisterIn(goRoot, state)
	if err != nil {
		t.Fatal(err)
	}
	issues := issueClient(t)
	title := "Hello"
	if _, err := issues.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{
		Workspace:  registered.Slug,
		Title:      &title,
		BodyChange: &yaruv1.SaveIssueRequest_Body{Body: "line\n"},
	})); err != nil {
		t.Fatal(err)
	}
	next := "Next"
	id := "1"
	if _, err := issues.SaveIssue(context.Background(), connect.NewRequest(&yaruv1.SaveIssueRequest{Workspace: registered.Slug, Id: &id, Title: &next})); err != nil {
		t.Fatal(err)
	}
	comments := commentClient(t)
	body := "note"
	if _, err := comments.SaveComment(context.Background(), connect.NewRequest(&yaruv1.SaveCommentRequest{Workspace: registered.Slug, Issue: &id, Body: &body})); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	command := exec.Command("bun", "-e", typeScriptOracle)
	command.Dir = root
	command.Env = append(os.Environ(),
		"ORACLE_ROOT="+tsRoot,
		"ORACLE_WEB="+filepath.Join(root, "src", "web.tsx"),
		"ORACLE_STORE="+filepath.Join(root, "src", "store.ts"),
		"YARU_NOW="+fixedNow,
		"TZ=Asia/Tokyo",
		"HOME="+home,
		"YARU_STATE_DIR="+state,
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_NOSYSTEM=1",
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("bun oracle: %v\n%s", err, output)
	}
	compareTrees(t, filepath.Join(goRoot, ".yaru"), filepath.Join(tsRoot, ".yaru"))
}

const typeScriptOracle = `
const root = process.env.ORACLE_ROOT
const { createApp } = await import(process.env.ORACLE_WEB)
process.chdir(root)
const { open } = await import(process.env.ORACLE_STORE)
const store = open(root)
const app = createApp(store, { basePath: "/p/ts-app" })
async function call(method, path, body) {
  const response = await app.request("http://yaru.invalid" + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(method + " " + path + " " + response.status + " " + (await response.text()))
  }
}
await call("POST", "/api/issues", { title: "Hello", body: "line\n" })
await call("POST", "/api/issues", { id: "1", title: "Next" })
await call("POST", "/api/comments", { issue: "1", body: "note" })
`

// page_service_test.go が未知の view を直接送るときに、同じ用意を使う
//
//declscope:package
func newAPIWorkspace(t *testing.T) (string, string) {
	t.Helper()
	home := t.TempDir()
	state := filepath.Join(home, "state")
	root := filepath.Join(home, "demo-app")
	prepareEnvironment(t, home, state)
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Chdir(root)
	initGit(t, root)
	if _, err := workspace.Init(root); err != nil {
		t.Fatal(err)
	}
	registered, err := workspace.RegisterIn(root, state)
	if err != nil {
		t.Fatal(err)
	}
	return root, registered.Slug
}

func prepareEnvironment(t *testing.T, home string, state string) {
	t.Helper()
	t.Setenv("HOME", home)
	t.Setenv("YARU_STATE_DIR", state)
	t.Setenv("YARU_NOW", fixedNow)
	t.Setenv("TZ", "Asia/Tokyo")
	t.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
}

func initGit(t *testing.T, root string) {
	t.Helper()
	git(t, root, "init", "-q", "-b", "develop")
	git(t, root, "config", "user.name", "Spec Author")
	git(t, root, "config", "user.email", "spec@example.com")
}

func git(t *testing.T, root string, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = root
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, output)
	}
}

func testServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle(IssueMountPath, IssueHandler())
	mux.Handle(CommentMountPath, CommentHandler())
	mux.Handle(PageMountPath, PageHandler())
	mux.Handle(ProjectMountPath, ProjectHandler())
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func issueClient(t *testing.T) yaruv1connect.IssueServiceClient {
	t.Helper()
	server := testServer(t)
	return yaruv1connect.NewIssueServiceClient(server.Client(), server.URL)
}

func commentClient(t *testing.T) yaruv1connect.CommentServiceClient {
	t.Helper()
	server := testServer(t)
	return yaruv1connect.NewCommentServiceClient(server.Client(), server.URL)
}

func pageClient(t *testing.T) yaruv1connect.PageServiceClient {
	t.Helper()
	server := testServer(t)
	return yaruv1connect.NewPageServiceClient(server.Client(), server.URL)
}

func projectClient(t *testing.T) yaruv1connect.ProjectServiceClient {
	t.Helper()
	server := testServer(t)
	return yaruv1connect.NewProjectServiceClient(server.Client(), server.URL)
}

// page_service_test.go が Connect のコードと文を照合する
//
//declscope:package
func expectConnect(t *testing.T, err error, code connect.Code, message string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s %s", code, message)
	}
	connectError := new(connect.Error)
	if !errorsAs(err, connectError) {
		t.Fatalf("error type %T: %v", err, err)
	}
	if connectError.Code() != code || connectError.Message() != message {
		t.Fatalf("got %s %q, want %s %q", connectError.Code(), connectError.Message(), code, message)
	}
}

func errorsAs(err error, target *connect.Error) bool {
	var typed *connect.Error
	if !errors.As(err, &typed) {
		return false
	}
	*target = *typed
	return true
}

func workspaceRoot(t *testing.T, slug string) string {
	t.Helper()
	registered, found := workspace.Find(slug, workspace.StateDirectory())
	if !found {
		t.Fatalf("workspace %s is not registered", slug)
	}
	return registered.Root
}

func expectFile(t *testing.T, path string, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != expected {
		t.Fatalf("file %s\nexpected:\n%s\nactual:\n%s", path, expected, content)
	}
}

func readText(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

func writeQuestion(t *testing.T, root string) {
	t.Helper()
	directory := filepath.Join(root, ".yaru", "questions")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	text := "" +
		"---\n" +
		"id: 1\n" +
		"title: Need a decision\n" +
		"status: open\n" +
		"issue: 1\n" +
		"priority:\n" +
		"defaultAction:\n" +
		"answerBy: 2026-09-28T18:00:00.000Z\n" +
		"options:\n" +
		"author: Spec Author\n" +
		"session:\n" +
		"worktree:\n" +
		"branch:\n" +
		"answeredBy:\n" +
		"answeredAt:\n" +
		"acknowledgedAt:\n" +
		"notifiedExpiringAt:\n" +
		"canceledAt:\n" +
		"createdAt: 2026-09-28T12:00:00.000Z\n" +
		"updatedAt: 2026-09-28T12:00:00.000Z\n" +
		"---\n" +
		"\n" +
		"背景\n"
	if err := os.WriteFile(filepath.Join(directory, "1.md"), []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Dir(filepath.Dir(filepath.Dir(file)))
}

func compareTrees(t *testing.T, left string, right string) {
	t.Helper()
	leftFiles := treeFiles(t, left)
	rightFiles := treeFiles(t, right)
	if len(leftFiles) != len(rightFiles) {
		t.Fatalf("file count go=%d ts=%d\ngo %#v\nts %#v", len(leftFiles), len(rightFiles), leftFiles, rightFiles)
	}
	for path, content := range leftFiles {
		other, ok := rightFiles[path]
		if !ok || other != content {
			t.Fatalf("file %s\ngo:\n%s\nts:\n%s", path, content, other)
		}
	}
}

func treeFiles(t *testing.T, root string) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files[relative] = string(content)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func pointerTo(value string) *string {
	return &value
}
