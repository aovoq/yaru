//declscope:core

package terminal

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// docs/spec/security.md の「全部の入口での Host と Origin」「WebSocket」「テスト」
// coder/websocket v1.8.15 の Accept は Origin が空でも通す (accept.go:229-232)。ここではその前に拒否する

const expectedContentSecurityPolicy = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' http: https:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

func TestParsePublicHost(t *testing.T) {
	cases := []struct {
		value    string
		expected string
		ok       bool
	}{
		{value: "mac.example.ts.net", expected: "mac.example.ts.net", ok: true},
		{value: "Mac.Example.Ts.Net.", expected: "mac.example.ts.net", ok: true},
		{value: "mac.example.ts.net:443", expected: "mac.example.ts.net", ok: true},
		{value: "Mac.Example.Ts.Net.:443", expected: "mac.example.ts.net", ok: true},
		{value: "", ok: false},
		{value: "https://mac.example.ts.net", ok: false},
		{value: "user@mac.example.ts.net", ok: false},
		{value: "mac.example.ts.net:8443", ok: false},
		{value: "mac.example.ts.net:80", ok: false},
		{value: "mac.example.ts.net:443:443", ok: false},
	}
	for _, testCase := range cases {
		t.Run(testCase.value, func(t *testing.T) {
			parsed, err := ParsePublicHost(testCase.value)
			if testCase.ok {
				if err != nil {
					t.Fatal(err)
				}
				if parsed != testCase.expected {
					t.Fatalf("parsed = %s", parsed)
				}
				return
			}
			if err == nil {
				t.Fatalf("parsed %s", parsed)
			}
			message := err.Error()
			if !strings.HasPrefix(message, "invalid public host: expected a hostname or a hostname with port 443, actual ") {
				t.Fatalf("message = %s", message)
			}
			if strings.Contains(message, "\n") || strings.Contains(message, "\r") || strings.HasSuffix(message, ".") {
				t.Fatalf("message = %q", message)
			}
		})
	}
}

func TestWebSocketRejectionDoesNotStartHerdr(t *testing.T) {
	cases := []struct {
		name       string
		host       string
		origin     string
		upgrade    string
		site       string
		funnel     string
		method     string
		publicHost string
		login      string
		want       string
	}{
		{
			name:    "evil host",
			host:    "evil.example",
			origin:  "https://evil.example",
			upgrade: "websocket",
			want:    "rejected host: expected 127.0.0.1:47800 or localhost:47800, actual evil.example",
		},
		{
			name:       "public host with port 443",
			host:       "mac.example.ts.net:443",
			origin:     "https://mac.example.ts.net",
			upgrade:    "websocket",
			publicHost: "mac.example.ts.net",
			want:       "rejected host: expected 127.0.0.1:47800 or localhost:47800 or mac.example.ts.net, actual mac.example.ts.net:443",
		},
		{
			name:       "loopback host does not match public origin",
			host:       "127.0.0.1:47800",
			origin:     "https://mac.example.ts.net",
			upgrade:    "websocket",
			publicHost: "mac.example.ts.net",
			want:       "rejected origin: expected http://127.0.0.1:47800, actual https://mac.example.ts.net",
		},
		{
			name:    "cross origin",
			host:    "127.0.0.1:47800",
			origin:  "https://evil.example",
			upgrade: "websocket",
			want:    "rejected origin: expected http://127.0.0.1:47800, actual https://evil.example",
		},
		{
			name:    "missing origin",
			host:    "127.0.0.1:47800",
			upgrade: "websocket",
			want:    "rejected origin: expected http://127.0.0.1:47800, actual empty",
		},
		{
			name:    "null origin",
			host:    "127.0.0.1:47800",
			origin:  "null",
			upgrade: "websocket",
			want:    "rejected origin: expected http://127.0.0.1:47800, actual null",
		},
		{
			name:    "same site",
			host:    "127.0.0.1:47800",
			origin:  "http://127.0.0.1:47800",
			upgrade: "websocket",
			site:    "same-site",
			want:    "rejected sec-fetch-site: expected same-origin or absent, actual same-site",
		},
		{
			name:    "cross site",
			host:    "127.0.0.1:47800",
			origin:  "http://127.0.0.1:47800",
			upgrade: "websocket",
			site:    "cross-site",
			want:    "rejected sec-fetch-site: expected same-origin or absent, actual cross-site",
		},
		{
			name:    "sec fetch site none",
			host:    "127.0.0.1:47800",
			origin:  "http://127.0.0.1:47800",
			upgrade: "websocket",
			site:    "none",
			want:    "rejected sec-fetch-site: expected same-origin or absent, actual none",
		},
		{
			name:    "funnel",
			host:    "127.0.0.1:47800",
			origin:  "http://127.0.0.1:47800",
			upgrade: "websocket",
			site:    "same-origin",
			funnel:  "?1",
			want:    "rejected tailscale funnel request: expected absent, actual ?1",
		},
		{
			name:   "missing upgrade",
			host:   "127.0.0.1:47800",
			origin: "http://127.0.0.1:47800",
			want:   "rejected upgrade: expected websocket, actual empty",
		},
		{
			name:    "post",
			host:    "127.0.0.1:47800",
			origin:  "http://127.0.0.1:47800",
			upgrade: "websocket",
			method:  http.MethodPost,
			want:    "rejected method: expected GET, actual POST",
		},
		{
			name:    "host with userinfo",
			host:    "user@127.0.0.1:47800",
			origin:  "http://127.0.0.1:47800",
			upgrade: "websocket",
			want:    "rejected host: expected 127.0.0.1:47800 or localhost:47800, actual user@127.0.0.1:47800",
		},
		{
			name:    "login header does not authorize evil origin",
			host:    "127.0.0.1:47800",
			origin:  "https://evil.example",
			upgrade: "websocket",
			login:   "alice@example.com",
			want:    "rejected origin: expected http://127.0.0.1:47800, actual https://evil.example",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			handler, recordDirectory := rejectionHandler(t, testCase.publicHost)
			method := testCase.method
			if method == "" {
				method = http.MethodGet
			}
			request := httptest.NewRequest(method, "/ws/terminal?token=secret&session=production&dir=/tmp/evil&bin=/evil/herdr", nil)
			request.Host = testCase.host
			if testCase.origin != "" {
				request.Header.Set("Origin", testCase.origin)
			}
			if testCase.upgrade != "" {
				request.Header.Set("Upgrade", testCase.upgrade)
				request.Header.Set("Connection", "Upgrade")
			}
			if testCase.site != "" {
				request.Header.Set("Sec-Fetch-Site", testCase.site)
			}
			if testCase.funnel != "" {
				request.Header.Set("Tailscale-Funnel-Request", testCase.funnel)
			}
			if testCase.login != "" {
				request.Header.Set("Tailscale-User-Login", testCase.login)
			}
			var logBuffer bytes.Buffer
			previousLog := rejectionLog
			rejectionLog = &logBuffer
			t.Cleanup(func() { rejectionLog = previousLog })
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusForbidden {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if recorder.Body.String() != testCase.want {
				t.Fatalf("body = %q", recorder.Body.String())
			}
			assertSecurityHeaders(t, recorder.Header())
			if recorder.Header().Get("Content-Type") != "text/plain; charset=utf-8" {
				t.Fatalf("content type = %s", recorder.Header().Get("Content-Type"))
			}
			if logBuffer.String() != testCase.want+"\n" {
				t.Fatalf("log = %q", logBuffer.String())
			}
			assertHerdrNotStarted(t, recordDirectory)
		})
	}
}

func TestRejectedHostDropsNewlinesAndTruncates(t *testing.T) {
	handler, recordDirectory := rejectionHandler(t, "")
	host := "evil.example\r\nX-Injected: yes" + strings.Repeat("A", 200)
	request := httptest.NewRequest(http.MethodGet, "/ws/terminal?draft=secret-answer-draft", nil)
	request.Host = host
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Origin", "https://evil.example")
	var logBuffer bytes.Buffer
	previousLog := rejectionLog
	rejectionLog = &logBuffer
	t.Cleanup(func() { rejectionLog = previousLog })
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	body := recorder.Body.String()
	if strings.Contains(body, "\n") || strings.Contains(body, "\r") {
		t.Fatalf("body = %q", body)
	}
	if strings.Contains(logBuffer.String(), "\r") || strings.Contains(strings.TrimSuffix(logBuffer.String(), "\n"), "\n") {
		t.Fatalf("log = %q", logBuffer.String())
	}
	if strings.Contains(body, "secret-answer-draft") || strings.Contains(logBuffer.String(), "secret-answer-draft") {
		t.Fatalf("query leaked into body %q log %q", body, logBuffer.String())
	}
	actual := strings.TrimPrefix(body, "rejected host: expected 127.0.0.1:47800 or localhost:47800, actual ")
	if len(actual) > 128 {
		t.Fatalf("actual host is %d bytes: %q", len(actual), actual)
	}
	if strings.Contains(actual, "\n") {
		t.Fatalf("actual = %q", actual)
	}
	assertHerdrNotStarted(t, recordDirectory)
}

func TestPublicURLInConfigDoesNotAllowHost(t *testing.T) {
	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "config.yml"), []byte("publicUrl: https://evil.example\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	handler, recordDirectory := rejectionHandler(t, "")
	request := httptest.NewRequest(http.MethodGet, "/ws/terminal", nil)
	request.Host = "evil.example"
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Origin", "https://evil.example")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d", recorder.Code)
	}
	assertHerdrNotStarted(t, recordDirectory)
}

func TestSameOriginLoginHeaderMatchesAbsentLogin(t *testing.T) {
	withoutLogin := rejectionStatus(t, "")
	withLogin := rejectionStatus(t, "alice@example.com")
	if withoutLogin != http.StatusForbidden || withLogin != http.StatusForbidden {
		t.Fatalf("without = %d, with = %d", withoutLogin, withLogin)
	}
}

func rejectionStatus(t *testing.T, login string) int {
	t.Helper()
	handler, recordDirectory := rejectionHandler(t, "")
	request := httptest.NewRequest(http.MethodGet, "/ws/terminal", nil)
	request.Host = "evil.example"
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Origin", "https://evil.example")
	if login != "" {
		request.Header.Set("Tailscale-User-Login", login)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	assertHerdrNotStarted(t, recordDirectory)
	return recorder.Code
}

func rejectionHandler(t *testing.T, publicHost string) (http.Handler, string) {
	t.Helper()
	recordDirectory := t.TempDir()
	if err := os.WriteFile(fakeHerdrExecutable+".record", []byte(recordDirectory), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := Handler(Config{
		HerdrExecutable: fakeHerdrExecutable,
		ListenPort:      47800,
		PublicHost:      publicHost,
	})
	return handler, recordDirectory
}

func assertSecurityHeaders(t *testing.T, header http.Header) {
	t.Helper()
	if header.Get("Content-Security-Policy") != expectedContentSecurityPolicy {
		t.Fatalf("csp = %s", header.Get("Content-Security-Policy"))
	}
	policy := header.Get("Content-Security-Policy")
	if strings.Contains(policy, "unsafe-eval") {
		t.Fatalf("csp contains unsafe-eval: %s", policy)
	}
	for _, directive := range strings.Split(policy, ";") {
		trimmed := strings.TrimSpace(directive)
		if strings.HasPrefix(trimmed, "script-src ") && strings.Contains(trimmed, "unsafe-inline") {
			t.Fatalf("script-src allows unsafe-inline: %s", trimmed)
		}
		if strings.HasPrefix(trimmed, "script-src-attr ") && strings.Contains(trimmed, "unsafe-inline") {
			t.Fatalf("script-src-attr allows unsafe-inline: %s", trimmed)
		}
	}
	if !strings.Contains(policy, "style-src-attr 'unsafe-inline'") {
		t.Fatalf("csp = %s", policy)
	}
	if header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("referrer = %s", header.Get("Referrer-Policy"))
	}
	if header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("nosniff = %s", header.Get("X-Content-Type-Options"))
	}
	if header.Get("X-Frame-Options") != "DENY" {
		t.Fatalf("frame = %s", header.Get("X-Frame-Options"))
	}
	if header.Get("Set-Cookie") != "" {
		t.Fatalf("set-cookie = %s", header.Get("Set-Cookie"))
	}
	if header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("acao = %s", header.Get("Access-Control-Allow-Origin"))
	}
}

func assertHerdrNotStarted(t *testing.T, recordDirectory string) {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(recordDirectory, "*.pid"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("herdr started: %v", matches)
	}
}
