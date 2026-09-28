//declscope:core

package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aovoq/yaru/internal/workspace"
)

func TestMain(m *testing.M) {
	directory, err := os.MkdirTemp("", "yaru-server-test-")
	if err != nil {
		panic(err)
	}
	if err := os.Setenv("YARU_STATE_DIR", directory); err != nil {
		panic(err)
	}
	if err := os.Setenv("YARU_PUBLIC_HOST", ""); err != nil {
		panic(err)
	}
	if err := os.Setenv("YARU_TAILSCALE_BIN", "/nonexistent/yaru-tailscale-must-not-run"); err != nil {
		panic(err)
	}
	if err := os.Unsetenv("YARU_NOW"); err != nil {
		panic(err)
	}
	code := m.Run()
	_ = os.RemoveAll(directory)
	os.Exit(code)
}

func newTestServer(t *testing.T, configuration Configuration) *Server {
	t.Helper()
	if configuration.LogOutput == nil {
		configuration.LogOutput = io.Discard
	}
	if configuration.StartupOutput == nil {
		configuration.StartupOutput = io.Discard
	}
	if configuration.Port == 0 && !configuration.Ephemeral {
		configuration.Port = 47811
	}
	built, err := New(configuration)
	if err != nil {
		t.Fatal(err)
	}
	return built
}

func perform(handler http.Handler, method string, target string, host string, origin string, body string, headers map[string]string) *httptest.ResponseRecorder {
	reader := strings.NewReader(body)
	request := httptest.NewRequest(method, target, reader)
	if host != "" {
		request.Host = host
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func assertSecurityHeaders(t *testing.T, header http.Header) {
	t.Helper()
	policy := header.Get("Content-Security-Policy")
	if policy != contentSecurityPolicy {
		t.Fatalf("content-security-policy: expected the documented policy, actual %s", policy)
	}
	if strings.Contains(policy, "unsafe-eval") || strings.Contains(policy, "script-src 'unsafe-inline'") {
		t.Fatalf("csp allows script inline or eval: %s", policy)
	}
	if !strings.Contains(policy, "style-src-attr 'unsafe-inline'") {
		t.Fatalf("csp: expected style-src-attr 'unsafe-inline', actual %s", policy)
	}
	if header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("referrer-policy: expected no-referrer, actual %s", header.Get("Referrer-Policy"))
	}
	if header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("nosniff: expected nosniff, actual %s", header.Get("X-Content-Type-Options"))
	}
	if header.Get("X-Frame-Options") != "DENY" {
		t.Fatalf("frame: expected DENY, actual %s", header.Get("X-Frame-Options"))
	}
	if header.Get("Set-Cookie") != "" || header.Values("Set-Cookie") != nil && len(header.Values("Set-Cookie")) > 0 {
		t.Fatalf("set-cookie: expected none, actual %s", header.Get("Set-Cookie"))
	}
	if header.Get("Access-Control-Allow-Origin") != "" || header.Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("cors header was returned")
	}
}

func assertNoInlineScript(t *testing.T, html string) {
	t.Helper()
	lower := strings.ToLower(html)
	if strings.Contains(lower, "<style") {
		t.Fatalf("document has a style element: %s", html)
	}
	rest := lower
	for {
		index := strings.Index(rest, "<script")
		if index < 0 {
			return
		}
		rest = rest[index:]
		end := strings.Index(rest, ">")
		if end < 0 {
			t.Fatalf("unclosed script tag: %s", html)
		}
		tag := rest[:end]
		if !strings.Contains(tag, " src=") {
			t.Fatalf("inline script: %s", tag)
		}
		rest = rest[end+1:]
	}
}

func initWorkspace(t *testing.T, stateDirectory string, name string) (string, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(filepath.Join(root, ".yaru", "issues"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".yaru", "config.yml"), []byte("publicUrl: https://evil.example\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	registered, err := workspace.RegisterIn(root, stateDirectory)
	if err != nil {
		t.Fatal(err)
	}
	return registered.Slug, root
}

func unsetForTest(t *testing.T, key string) {
	t.Helper()
	previous, existed := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if !existed {
			_ = os.Unsetenv(key)
			return
		}
		_ = os.Setenv(key, previous)
	})
}
