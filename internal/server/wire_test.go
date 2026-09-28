//declscope:core

package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
	"github.com/aovoq/yaru/internal/terminal"
	"github.com/aovoq/yaru/internal/workspace"
)

// つないだ yaru serve は、未実装ではなく internal/api の手続きを返す。
// docs/spec/routes.md の「SPA と Connect への対応」
func TestWiredServerUsesAPIHandlers(t *testing.T) {
	stateDirectory := t.TempDir()
	t.Setenv("YARU_STATE_DIR", stateDirectory)
	t.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	slug, root := initWorkspace(t, stateDirectory, "wired")
	if _, err := os.Stat(filepath.Join(root, ".yaru", "config.yml")); err != nil {
		t.Fatal(err)
	}
	handler := newTestServer(t, Configuration{WireServices: true}).Handler()
	listed := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.ProjectServiceListProjectsProcedure, loopbackHost, loopbackOrigin, `{}`, map[string]string{"Content-Type": "application/json"})
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), slug) {
		t.Fatalf("list projects: status %d body %s", listed.Code, listed.Body.String())
	}
	if strings.Contains(listed.Body.String(), "not implemented") {
		t.Fatalf("project service is still unimplemented: %s", listed.Body.String())
	}
	saved := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.IssueServiceSaveIssueProcedure, loopbackHost, loopbackOrigin, `{"workspace":"`+slug+`","title":"Hello","body":"line\n"}`, map[string]string{"Content-Type": "application/json"})
	savedBody := saved.Body.String()
	savedID := strings.Contains(savedBody, `"id":"1"`) || strings.Contains(savedBody, `"id": "1"`)
	if saved.Code != http.StatusOK || !savedID {
		t.Fatalf("save issue: status %d body %s", saved.Code, savedBody)
	}
	issuePath := filepath.Join(root, ".yaru", "issues", "1.md")
	file, err := os.ReadFile(issuePath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(file), "title: Hello\n") || !strings.Contains(string(file), "line\n") {
		t.Fatalf("issue file:\n%s", file)
	}
	questions := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.QuestionServiceListQuestionsProcedure, loopbackHost, loopbackOrigin, `{"workspace":"`+slug+`"}`, map[string]string{"Content-Type": "application/json"})
	if questions.Code != http.StatusOK || strings.Contains(questions.Body.String(), "not implemented") {
		t.Fatalf("questions: status %d body %s", questions.Code, questions.Body.String())
	}
	dashboard := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.DashboardServiceGetDashboardProcedure, loopbackHost, loopbackOrigin, `{"workspace":"`+slug+`"}`, map[string]string{"Content-Type": "application/json"})
	if dashboard.Code != http.StatusOK || strings.Contains(dashboard.Body.String(), "not implemented") {
		t.Fatalf("dashboard: status %d body %s", dashboard.Code, dashboard.Body.String())
	}
	inbox := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.InboxServiceGetInboxProcedure, loopbackHost, loopbackOrigin, `{}`, map[string]string{"Content-Type": "application/json"})
	if inbox.Code != http.StatusOK || strings.Contains(inbox.Body.String(), "not implemented") {
		t.Fatalf("inbox: status %d body %s", inbox.Code, inbox.Body.String())
	}
	page := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, "", "", nil)
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "<html") {
		t.Fatalf("spa: status %d body %s", page.Code, page.Body.String())
	}
	if _, found := workspace.Find(slug, stateDirectory); !found {
		t.Fatal("workspace disappeared")
	}
}

// /ws/terminal はサーバの Host と Origin の検査を通ったあとで端末ハンドラに渡す。
// docs/spec/security.md の「WebSocket」。パスは internal/terminal の Path。
func TestWiredTerminalUsesServerHostCheck(t *testing.T) {
	handler := newTestServer(t, Configuration{WireServices: true}).Handler()
	rejected := perform(handler, http.MethodGet, loopbackURL+terminal.Path, "evil.example", "", "", map[string]string{"Upgrade": "websocket"})
	if rejected.Code != http.StatusForbidden {
		t.Fatalf("evil host: expected 403, actual %d %s", rejected.Code, rejected.Body.String())
	}
	missingOrigin := perform(handler, http.MethodGet, loopbackURL+terminal.Path, loopbackHost, "", "", map[string]string{"Upgrade": "websocket"})
	if missingOrigin.Code != http.StatusForbidden {
		t.Fatalf("missing origin: expected 403, actual %d %s", missingOrigin.Code, missingOrigin.Body.String())
	}
	reached := perform(handler, http.MethodGet, loopbackURL+terminal.Path, loopbackHost, loopbackOrigin, "", map[string]string{"Upgrade": "websocket", "Sec-Fetch-Site": "same-origin"})
	if reached.Code == http.StatusNotFound || reached.Code == http.StatusForbidden {
		t.Fatalf("same-origin terminal: expected the terminal handler, actual %d %s", reached.Code, reached.Body.String())
	}
}
