//declscope:core

package server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	connect "connectrpc.com/connect"
	v1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
)

const loopbackHost = "127.0.0.1:47811"
const loopbackOrigin = "http://127.0.0.1:47811"
const loopbackURL = "http://127.0.0.1:47811"

func TestListenAddressIsLoopback(t *testing.T) {
	address, err := ListenAddress(Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	if address != "127.0.0.1:47800" {
		t.Fatalf("listen address: expected 127.0.0.1:47800, actual %s", address)
	}
	if DefaultPort != 47800 {
		t.Fatalf("default port: expected 47800, actual %d", DefaultPort)
	}
	built := newTestServer(t, Configuration{Ephemeral: true})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = running.Close() })
	tcpAddress, ok := running.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("address type: expected TCP, actual %T", running.Addr())
	}
	if tcpAddress.IP.String() != "127.0.0.1" {
		t.Fatalf("listen ip: expected 127.0.0.1, actual %s", tcpAddress.IP.String())
	}
	if tcpAddress.IP.To4() == nil {
		t.Fatal("listen address is not IPv4")
	}
}

func TestServeReturnsNilWhenThePortIsTaken(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	port := listener.Addr().(*net.TCPAddr).Port
	stdoutFile, err := os.Create(filepath.Join(t.TempDir(), "stdout"))
	if err != nil {
		t.Fatal(err)
	}
	originalStdout := os.Stdout
	os.Stdout = stdoutFile
	t.Cleanup(func() {
		os.Stdout = originalStdout
		_ = stdoutFile.Close()
	})
	if err := Serve(port); err != nil {
		t.Fatal(err)
	}
	if _, err := stdoutFile.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	written, err := io.ReadAll(stdoutFile)
	if err != nil {
		t.Fatal(err)
	}
	expected := fmt.Sprintf("yaru  already running  http://127.0.0.1:%d\n", port)
	if string(written) != expected {
		t.Fatalf("stdout: expected %q, actual %q", expected, written)
	}
}

func TestTakenPortReportsAlreadyRunning(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	port := listener.Addr().(*net.TCPAddr).Port
	var startup bytes.Buffer
	built := newTestServer(t, Configuration{Port: port, StartupOutput: &startup})
	_, err = built.Start()
	if !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("expected already running, actual %v", err)
	}
	expected := fmt.Sprintf("yaru  already running  http://127.0.0.1:%d\n", port)
	if startup.String() != expected {
		t.Fatalf("startup: expected %q, actual %q", expected, startup.String())
	}
}

func TestInvalidPortAndYaruNow(t *testing.T) {
	if _, err := New(Configuration{Port: 70000, LogOutput: io.Discard, StartupOutput: io.Discard}); err == nil || err.Error() != "invalid port: 70000" {
		t.Fatalf("port: expected invalid port: 70000, actual %v", err)
	}
	t.Setenv("YARU_NOW", "yesterday")
	_, err := New(Configuration{Port: 47811, LogOutput: io.Discard, StartupOutput: io.Discard})
	if err == nil || !strings.Contains(err.Error(), "invalid YARU_NOW:") || !strings.Contains(err.Error(), "yesterday") {
		t.Fatalf("YARU_NOW: expected the clock error, actual %v", err)
	}
}

type saveIssueRecorder struct {
	yaruv1connect.UnimplementedIssueServiceHandler
	path  string
	calls int
}

func (recorder *saveIssueRecorder) SaveIssue(context.Context, *connect.Request[v1.SaveIssueRequest]) (*connect.Response[v1.SaveIssueResponse], error) {
	recorder.calls++
	if err := os.WriteFile(recorder.path, []byte("changed"), 0o644); err != nil {
		return nil, err
	}
	return connect.NewResponse(&v1.SaveIssueResponse{}), nil
}

func TestHostOriginAndFunnel(t *testing.T) {
	directory := t.TempDir()
	marker := filepath.Join(directory, "issue.md")
	if err := os.WriteFile(marker, []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	recorder := &saveIssueRecorder{path: marker}
	var logBuffer bytes.Buffer
	built := newTestServer(t, Configuration{
		Handlers:  Handlers{Issue: recorder},
		LogOutput: &logBuffer,
	})
	handler := built.Handler()
	saveURL := loopbackURL + yaruv1connect.IssueServiceSaveIssueProcedure
	jsonHeaders := map[string]string{"Content-Type": "application/json"}

	rejected := []struct {
		name    string
		method  string
		target  string
		host    string
		origin  string
		headers map[string]string
	}{
		{name: "evil get", method: http.MethodGet, target: loopbackURL + "/", host: "evil.example"},
		{name: "evil post", method: http.MethodPost, target: saveURL, host: "evil.example", headers: jsonHeaders},
		{name: "evil connect", method: http.MethodPost, target: saveURL, host: "evil.example", headers: jsonHeaders},
		{name: "evil websocket", method: http.MethodGet, target: loopbackURL + "/", host: "evil.example", headers: map[string]string{"Upgrade": "websocket"}},
		{name: "origin mismatch", method: http.MethodPost, target: saveURL, host: loopbackHost, origin: "https://evil.example", headers: jsonHeaders},
	}
	for _, testCase := range rejected {
		t.Run(testCase.name, func(t *testing.T) {
			before := recorder.calls
			response := perform(handler, testCase.method, testCase.target, testCase.host, testCase.origin, `{"title":"secret-answer-text"}`, testCase.headers)
			if response.Code != http.StatusForbidden {
				t.Fatalf("status: expected 403, actual %d body %s", response.Code, response.Body.String())
			}
			assertSecurityHeaders(t, response.Header())
			if recorder.calls != before {
				t.Fatal("handler ran after rejection")
			}
			body, err := os.ReadFile(marker)
			if err != nil {
				t.Fatal(err)
			}
			if string(body) != "original" {
				t.Fatalf("file changed: %s", body)
			}
			if strings.Contains(logBuffer.String(), "secret-answer-text") || strings.Contains(response.Body.String(), "secret-answer-text") {
				t.Fatal("rejection included the request body")
			}
		})
	}

	allowedPost := perform(handler, http.MethodPost, saveURL, loopbackHost, loopbackOrigin, `{}`, jsonHeaders)
	if allowedPost.Code == http.StatusForbidden || allowedPost.Code == http.StatusUnsupportedMediaType {
		t.Fatalf("matching origin: expected the procedure, actual %d %s", allowedPost.Code, allowedPost.Body.String())
	}
	if recorder.calls != 1 {
		t.Fatalf("calls: expected 1, actual %d", recorder.calls)
	}

	localhost := perform(handler, http.MethodPost, "http://localhost:47811"+yaruv1connect.IssueServiceSaveIssueProcedure, "localhost:47811", "http://localhost:47811", `{}`, jsonHeaders)
	if localhost.Code == http.StatusForbidden {
		t.Fatalf("localhost: %s", localhost.Body.String())
	}
	normalized := perform(handler, http.MethodPost, saveURL, "LOCALHOST:47811", "http://localhost:47811", `{}`, jsonHeaders)
	if normalized.Code == http.StatusForbidden {
		t.Fatalf("LOCALHOST: %s", normalized.Body.String())
	}
	dotted := perform(handler, http.MethodPost, saveURL, "localhost.:47811", "http://localhost:47811", `{}`, jsonHeaders)
	if dotted.Code == http.StatusForbidden {
		t.Fatalf("trailing dot: %s", dotted.Body.String())
	}

	noOriginGet := perform(handler, http.MethodGet, loopbackURL+"/?draft=secret-query", loopbackHost, "", "", map[string]string{"Sec-Fetch-Site": "cross-site"})
	if noOriginGet.Code != http.StatusOK {
		t.Fatalf("get without origin: expected 200, actual %d", noOriginGet.Code)
	}
	crossSitePost := perform(handler, http.MethodPost, saveURL, loopbackHost, "", `{}`, map[string]string{"Content-Type": "application/json", "Sec-Fetch-Site": "cross-site"})
	if crossSitePost.Code != http.StatusForbidden {
		t.Fatalf("cross-site post: expected 403, actual %d", crossSitePost.Code)
	}
	bothAbsent := perform(handler, http.MethodPost, saveURL, loopbackHost, "", `{}`, jsonHeaders)
	if bothAbsent.Code == http.StatusForbidden {
		t.Fatalf("post without origin or sec-fetch-site: %s", bothAbsent.Body.String())
	}
	sameSite := perform(handler, http.MethodPost, saveURL, loopbackHost, loopbackOrigin, `{}`, map[string]string{"Content-Type": "application/json", "Sec-Fetch-Site": "same-site"})
	if sameSite.Code != http.StatusForbidden {
		t.Fatalf("same-site: expected 403, actual %d", sameSite.Code)
	}
	noneSite := perform(handler, http.MethodPost, saveURL, loopbackHost, loopbackOrigin, `{}`, map[string]string{"Content-Type": "application/json", "Sec-Fetch-Site": "none"})
	if noneSite.Code != http.StatusForbidden {
		t.Fatalf("sec-fetch-site none: expected 403, actual %d", noneSite.Code)
	}

	funnel := perform(handler, http.MethodPost, saveURL, loopbackHost, loopbackOrigin, `{}`, map[string]string{"Content-Type": "application/json", "Tailscale-Funnel-Request": "?1"})
	if funnel.Code != http.StatusForbidden {
		t.Fatalf("funnel: expected 403, actual %d", funnel.Code)
	}
	withLogin := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, loopbackOrigin, "", map[string]string{"Tailscale-User-Login": "alice@example.com"})
	withoutLogin := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, loopbackOrigin, "", nil)
	if withLogin.Code != withoutLogin.Code {
		t.Fatalf("login header changed the result: %d and %d", withLogin.Code, withoutLogin.Code)
	}
	spoofed := perform(handler, http.MethodPost, saveURL, loopbackHost, "https://evil.example", `{}`, map[string]string{"Content-Type": "application/json", "Tailscale-User-Login": "alice@example.com"})
	if spoofed.Code != http.StatusForbidden {
		t.Fatal("spoofed login bypassed origin rejection")
	}
	if strings.Contains(logBuffer.String(), "secret-query") || strings.Contains(logBuffer.String(), "alice@example.com") {
		t.Fatalf("log leaked query or identity: %s", logBuffer.String())
	}
}

func TestPublicHostMatching(t *testing.T) {
	var logBuffer bytes.Buffer
	built := newTestServer(t, Configuration{
		PublicHost:    "mac.example.ts.net",
		PublicHostSet: true,
		LogOutput:     &logBuffer,
	})
	handler := built.Handler()
	pass := perform(handler, http.MethodGet, "http://mac.example.ts.net/", "mac.example.ts.net", "https://mac.example.ts.net", "", nil)
	if pass.Code != http.StatusOK {
		t.Fatalf("public host: expected 200, actual %d %s", pass.Code, pass.Body.String())
	}
	folded := perform(handler, http.MethodGet, "http://mac.example.ts.net/", "Mac.Example.Ts.Net.", "https://mac.example.ts.net", "", nil)
	if folded.Code != http.StatusOK {
		t.Fatalf("folded public host: expected 200, actual %d %s", folded.Code, folded.Body.String())
	}
	wrongOrigin := perform(handler, http.MethodGet, "http://mac.example.ts.net/", "mac.example.ts.net", "https://evil.example", "", nil)
	if wrongOrigin.Code != http.StatusForbidden {
		t.Fatal("public host accepted a different origin")
	}
	withPort := perform(handler, http.MethodGet, "http://mac.example.ts.net/", "mac.example.ts.net:443", "https://mac.example.ts.net", "", nil)
	if withPort.Code != http.StatusForbidden {
		t.Fatal("public host with :443 was accepted")
	}
	cross := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.IssueServiceSaveIssueProcedure, loopbackHost, "https://mac.example.ts.net", `{}`, map[string]string{"Content-Type": "application/json"})
	if cross.Code != http.StatusForbidden {
		t.Fatal("loopback host accepted the public origin")
	}

	stateDirectory := t.TempDir()
	t.Setenv("YARU_STATE_DIR", stateDirectory)
	root := filepath.Join(t.TempDir(), "evil-workspace")
	if err := os.MkdirAll(filepath.Join(root, ".yaru"), 0o755); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, ".yaru", "config.yml")
	if err := os.WriteFile(configPath, []byte("publicUrl: https://evil.example\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	fromConfig := perform(handler, http.MethodGet, "http://evil.example/", "evil.example", "https://evil.example", "", nil)
	if fromConfig.Code != http.StatusForbidden {
		t.Fatal("config.yml publicUrl became a public host")
	}
	after, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("config.yml changed")
	}
}

func TestConnectMethodAndContentType(t *testing.T) {
	recorder := &saveIssueRecorder{path: filepath.Join(t.TempDir(), "issue.md")}
	if err := os.WriteFile(recorder.path, []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := newTestServer(t, Configuration{Handlers: Handlers{Issue: recorder}}).Handler()
	procedure := loopbackURL + yaruv1connect.IssueServiceSaveIssueProcedure
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		before := recorder.calls
		response := perform(handler, method, procedure, loopbackHost, loopbackOrigin, "", nil)
		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: expected 405, actual %d %s", method, response.Code, response.Body.String())
		}
		if recorder.calls != before {
			t.Fatal("procedure ran for a non-POST")
		}
		assertSecurityHeaders(t, response.Header())
	}
	evilGet := perform(handler, http.MethodGet, procedure, "evil.example", "", "", nil)
	if evilGet.Code != http.StatusForbidden {
		t.Fatalf("evil host get: expected 403 before 405, actual %d", evilGet.Code)
	}
	for _, contentType := range []string{"text/plain", "application/grpc", "application/grpc-web", "application/connect+xml"} {
		response := perform(handler, http.MethodPost, procedure, loopbackHost, loopbackOrigin, "nope", map[string]string{"Content-Type": contentType})
		if response.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("%s: expected 415, actual %d %s", contentType, response.Code, response.Body.String())
		}
	}
	for _, contentType := range []string{"application/json", "application/proto", "application/connect+json", "application/connect+proto", "application/json; charset=utf-8"} {
		response := perform(handler, http.MethodPost, procedure, loopbackHost, loopbackOrigin, "{}", map[string]string{"Content-Type": contentType})
		if response.Code == http.StatusUnsupportedMediaType {
			t.Fatalf("%s was rejected with 415: %s", contentType, response.Body.String())
		}
	}
	if recorder.calls == 0 {
		t.Fatal("allowed content type did not reach the procedure")
	}
}

func TestWebSocketOriginIsRequired(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "herdr-ran")
	script := filepath.Join(t.TempDir(), "herdr")
	if err := os.WriteFile(script, []byte("#!/bin/sh\ntouch "+shellQuote(marker)+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	called := 0
	built := newTestServer(t, Configuration{
		HerdrExecutable: script,
		WebSocket: http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			called++
			responseWriter.WriteHeader(http.StatusNoContent)
		}),
	})
	handler := built.Handler()
	missing := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, "", "", map[string]string{"Upgrade": "websocket"})
	if missing.Code != http.StatusForbidden || called != 0 {
		t.Fatalf("missing origin: status %d called %d", missing.Code, called)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("herdr started for a rejected websocket")
	}
	for _, site := range []string{"same-site", "cross-site"} {
		response := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, loopbackOrigin, "", map[string]string{"Upgrade": "WebSocket", "Sec-Fetch-Site": site})
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s: expected 403, actual %d", site, response.Code)
		}
	}
	if called != 0 {
		t.Fatal("rejected websocket reached the handler")
	}
	passed := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, loopbackOrigin, "", map[string]string{"Upgrade": "websocket", "Sec-Fetch-Site": "same-origin"})
	if passed.Code != http.StatusNoContent || called != 1 {
		t.Fatalf("same-origin: status %d called %d body %s", passed.Code, called, passed.Body.String())
	}
	withoutSite := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, loopbackOrigin, "", map[string]string{"Upgrade": "websocket"})
	if withoutSite.Code != http.StatusNoContent || called != 2 {
		t.Fatalf("origin without sec-fetch-site: status %d called %d", withoutSite.Code, called)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("the websocket check started herdr")
	}
	portless := perform(handler, http.MethodGet, loopbackURL+"/", "127.0.0.1", loopbackOrigin, "", nil)
	if portless.Code != http.StatusForbidden {
		t.Fatal("host without a port was accepted")
	}
	nullOrigin := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.IssueServiceSaveIssueProcedure, loopbackHost, "null", `{}`, map[string]string{"Content-Type": "application/json"})
	if nullOrigin.Code != http.StatusForbidden {
		t.Fatal("origin null was accepted")
	}
	sameOrigin := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.IssueServiceSaveIssueProcedure, loopbackHost, loopbackOrigin, `{}`, map[string]string{"Content-Type": "application/json", "Sec-Fetch-Site": "same-origin"})
	if sameOrigin.Code == http.StatusForbidden {
		t.Fatalf("same-origin post: %s", sameOrigin.Body.String())
	}
}

func TestResponseHeadersAndDocument(t *testing.T) {
	handler := newTestServer(t, Configuration{}).Handler()
	success := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, "", "", nil)
	forbidden := perform(handler, http.MethodGet, loopbackURL+"/", "evil.example", "", "", nil)
	missing := perform(handler, http.MethodGet, loopbackURL+"/missing", loopbackHost, "", "", nil)
	assertSecurityHeaders(t, success.Header())
	assertSecurityHeaders(t, forbidden.Header())
	assertSecurityHeaders(t, missing.Header())
	if success.Code != http.StatusOK || missing.Code != http.StatusNotFound {
		t.Fatalf("status: success %d missing %d", success.Code, missing.Code)
	}
	assertNoInlineScript(t, success.Body.String())
	head := perform(handler, http.MethodHead, loopbackURL+"/", loopbackHost, "", "", nil)
	if head.Code != http.StatusOK || head.Body.Len() != 0 {
		t.Fatalf("head: status %d body %d", head.Code, head.Body.Len())
	}
	if head.Header().Get("Content-Type") != success.Header().Get("Content-Type") {
		t.Fatalf("head content type: expected %s, actual %s", success.Header().Get("Content-Type"), head.Header().Get("Content-Type"))
	}
	if head.Header().Get("Content-Length") != success.Header().Get("Content-Length") {
		t.Fatalf("head length: expected %s, actual %s", success.Header().Get("Content-Length"), head.Header().Get("Content-Length"))
	}
}

func TestRejectionStripsControlCharacters(t *testing.T) {
	var logBuffer bytes.Buffer
	handler := newTestServer(t, Configuration{LogOutput: &logBuffer}).Handler()
	request := httptest.NewRequest(http.MethodGet, loopbackURL+"/?draft=secret-answer-text", nil)
	request.Host = "evil\r\n" + strings.Repeat("a", 200)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status: expected 403, actual %d", recorder.Code)
	}
	body := recorder.Body.String()
	if strings.Contains(body, "\n") || strings.Contains(body, "\r") {
		t.Fatalf("body kept a newline: %q", body)
	}
	logText := logBuffer.String()
	if strings.Contains(strings.TrimSuffix(logText, "\n"), "\n") || strings.Contains(logText, "\r") {
		t.Fatalf("log kept a newline: %q", logText)
	}
	prefix := "rejected host: expected 127.0.0.1:47811 or localhost:47811 or the configured public host, actual "
	actual := strings.TrimPrefix(strings.TrimSuffix(logText, "\n"), prefix)
	if len(actual) > 128 || len(actual) == 0 {
		t.Fatalf("logged host length: expected 1 to 128, actual %d", len(actual))
	}
	if strings.Contains(logText, "secret-answer-text") {
		t.Fatal("log included the query")
	}
}

func TestLogFileMode(t *testing.T) {
	directory := t.TempDir()
	stdoutFile, err := os.Create(filepath.Join(directory, "stdout"))
	if err != nil {
		t.Fatal(err)
	}
	stderrFile, err := os.Create(filepath.Join(directory, "stderr"))
	if err != nil {
		t.Fatal(err)
	}
	if err := stdoutFile.Chmod(0o644); err != nil {
		t.Fatal(err)
	}
	if err := stderrFile.Chmod(0o644); err != nil {
		t.Fatal(err)
	}
	originalStdout := os.Stdout
	originalStderr := os.Stderr
	os.Stdout = stdoutFile
	os.Stderr = stderrFile
	t.Cleanup(func() {
		os.Stdout = originalStdout
		os.Stderr = originalStderr
		_ = stdoutFile.Close()
		_ = stderrFile.Close()
	})
	built := newTestServer(t, Configuration{Ephemeral: true})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = running.Close() })
	for _, file := range []*os.File{stdoutFile, stderrFile} {
		info, statErr := file.Stat()
		if statErr != nil {
			t.Fatal(statErr)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("mode: expected 0600, actual %#o", info.Mode().Perm())
		}
	}
}

func TestPipeStdoutIsLeftAlone(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = reader.Close()
		_ = writer.Close()
	})
	before, err := writer.Stat()
	if err != nil {
		t.Fatal(err)
	}
	originalStdout := os.Stdout
	os.Stdout = writer
	t.Cleanup(func() { os.Stdout = originalStdout })
	built := newTestServer(t, Configuration{Ephemeral: true})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = running.Close() })
	after, err := writer.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if before.Mode() != after.Mode() {
		t.Fatalf("pipe mode changed: expected %s, actual %s", before.Mode(), after.Mode())
	}
	response, err := http.Get(running.URL() + "/")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status: expected 200, actual %d", response.StatusCode)
	}
}

func TestChmodFailureDoesNotStopStartup(t *testing.T) {
	originalChmod := fchmod
	fchmod = func(int, uint32) error { return errors.New("read-only file system") }
	t.Cleanup(func() { fchmod = originalChmod })
	originalTerminal := stderrIsTerminal
	stderrIsTerminal = func(*os.File) bool { return true }
	t.Cleanup(func() { stderrIsTerminal = originalTerminal })
	stderrFile, err := os.Create(filepath.Join(t.TempDir(), "stderr"))
	if err != nil {
		t.Fatal(err)
	}
	stdoutFile, err := os.Create(filepath.Join(t.TempDir(), "stdout"))
	if err != nil {
		t.Fatal(err)
	}
	originalStdout := os.Stdout
	originalStderr := os.Stderr
	os.Stdout = stdoutFile
	os.Stderr = stderrFile
	t.Cleanup(func() {
		os.Stdout = originalStdout
		os.Stderr = originalStderr
		_ = stdoutFile.Close()
		_ = stderrFile.Close()
	})
	built := newTestServer(t, Configuration{Ephemeral: true})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = running.Close() })
	if _, err := stderrFile.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	reason, err := io.ReadAll(stderrFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(reason), "log file mode: expected 0600, actual chmod failed: read-only file system") {
		t.Fatalf("reason: %s", reason)
	}
	response, err := http.Get(running.URL() + "/")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status: expected 200, actual %d", response.StatusCode)
	}
}

func TestDoesNotRedirectToAClientURL(t *testing.T) {
	stateDirectory := t.TempDir()
	t.Setenv("YARU_STATE_DIR", stateDirectory)
	slug, _ := initWorkspace(t, stateDirectory, "board")
	handler := newTestServer(t, Configuration{}).Handler()
	for _, target := range []string{
		loopbackURL + "/?returnTo=https://evil.example",
		loopbackURL + "/?returnTo=//evil.example",
		loopbackURL + "/?returnTo=/\\evil.example",
		loopbackURL + "/p/" + slug,
		loopbackURL + "/p/missing",
		loopbackURL + "/questions/1/answer",
	} {
		response := perform(handler, http.MethodGet, target, loopbackHost, "", "", nil)
		if response.Code == http.StatusFound || response.Code == http.StatusSeeOther {
			t.Fatalf("%s redirected: %d %s", target, response.Code, response.Header().Get("Location"))
		}
		location := response.Header().Get("Location")
		if strings.Contains(location, "evil.example") {
			t.Fatalf("location left the server: %s", location)
		}
	}
	post := perform(handler, http.MethodPost, loopbackURL+"/questions/1/answer", loopbackHost, loopbackOrigin, "answer=secret", map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if post.Code == http.StatusSeeOther || post.Header().Get("Location") != "" {
		t.Fatalf("form post redirected: %d %s", post.Code, post.Header().Get("Location"))
	}
}

type markdownQuestion struct {
	yaruv1connect.UnimplementedQuestionServiceHandler
}

func (markdownQuestion) GetQuestion(_ context.Context, request *connect.Request[v1.GetQuestionRequest]) (*connect.Response[v1.GetQuestionResponse], error) {
	return connect.NewResponse(&v1.GetQuestionResponse{Question: &v1.Question{Body: request.Msg.GetId()}}), nil
}

func TestRPCReturnsRawMarkdown(t *testing.T) {
	handler := newTestServer(t, Configuration{Handlers: Handlers{Question: markdownQuestion{}}}).Handler()
	markdown := "# Title\n\n**bold**"
	response := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.QuestionServiceGetQuestionProcedure, loopbackHost, loopbackOrigin, `{"id":"# Title\n\n**bold**"}`, map[string]string{"Content-Type": "application/json"})
	if response.Code != http.StatusOK {
		t.Fatalf("status: expected 200, actual %d %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if !strings.Contains(body, markdown) && !strings.Contains(body, `**bold**`) {
		t.Fatalf("response dropped the markdown: %s", body)
	}
	if strings.Contains(body, "<p") || strings.Contains(body, "<h1") || strings.Contains(body, "<strong") {
		t.Fatalf("response rendered markdown: %s", body)
	}
}

func TestUnimplementedService(t *testing.T) {
	handler := newTestServer(t, Configuration{}).Handler()
	response := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.ProjectServiceListProjectsProcedure, loopbackHost, loopbackOrigin, `{}`, map[string]string{"Content-Type": "application/json"})
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("status: expected 501, actual %d %s", response.Code, response.Body.String())
	}
	assertSecurityHeaders(t, response.Header())
	if !strings.Contains(response.Body.String(), "not implemented") {
		t.Fatalf("body: %s", response.Body.String())
	}
	replaced := newTestServer(t, Configuration{Handlers: Handlers{Project: projectStub{}}}).Handler()
	ok := perform(replaced, http.MethodPost, loopbackURL+yaruv1connect.ProjectServiceListProjectsProcedure, loopbackHost, loopbackOrigin, `{}`, map[string]string{"Content-Type": "application/json"})
	if ok.Code != http.StatusOK || !strings.Contains(ok.Body.String(), "demo") {
		t.Fatalf("registered handler: %d %s", ok.Code, ok.Body.String())
	}
}

type projectStub struct{}

func (projectStub) ListProjects(context.Context, *connect.Request[v1.ListProjectsRequest]) (*connect.Response[v1.ListProjectsResponse], error) {
	return connect.NewResponse(&v1.ListProjectsResponse{Projects: []*v1.Project{{Slug: "demo"}}}), nil
}

func TestTerminalDocumentAllowsInlineStyle(t *testing.T) {
	// /terminal の文書だけ style-src に unsafe-inline を足す。他の文書と 403 は足さない。
	// docs/spec/security.md の「応答ヘッダー」。https://www.w3.org/TR/CSP3/#directive-style-src
	handler := newTestServer(t, Configuration{}).Handler()
	document := perform(handler, http.MethodGet, loopbackURL+"/terminal", loopbackHost, "", "", nil)
	if document.Code != http.StatusOK || !strings.Contains(document.Body.String(), "<html") {
		t.Fatalf("terminal document: status %d body %s", document.Code, document.Body.String())
	}
	policy := document.Header().Get("Content-Security-Policy")
	if policy != terminalContentSecurityPolicy {
		t.Fatalf("terminal csp: expected %s, actual %s", terminalContentSecurityPolicy, policy)
	}
	if strings.Contains(policy, "script-src 'self' 'unsafe-inline'") || strings.Contains(policy, "unsafe-eval") {
		t.Fatalf("terminal csp allows script inline or eval: %s", policy)
	}
	home := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, "", "", nil)
	assertSecurityHeaders(t, home.Header())
	if strings.Contains(home.Header().Get("Content-Security-Policy"), "style-src 'self' 'unsafe-inline'") {
		t.Fatalf("home csp allows inline style: %s", home.Header().Get("Content-Security-Policy"))
	}
	trailing := perform(handler, http.MethodGet, loopbackURL+"/terminal/", loopbackHost, "", "", nil)
	if trailing.Code != http.StatusNotFound {
		t.Fatalf("trailing slash: expected 404, actual %d", trailing.Code)
	}
	rejected := perform(handler, http.MethodGet, loopbackURL+"/terminal", "evil.example", "", "", nil)
	if rejected.Code != http.StatusForbidden {
		t.Fatalf("evil host: expected 403, actual %d", rejected.Code)
	}
	assertSecurityHeaders(t, rejected.Header())
}

func TestReadHeaderTimeoutIsTenSeconds(t *testing.T) {
	built := newTestServer(t, Configuration{Ephemeral: true})
	running, err := built.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = running.Close() })
	if running.httpServer.ReadHeaderTimeout != 10*time.Second {
		t.Fatalf("read header timeout: expected 10s, actual %s", running.httpServer.ReadHeaderTimeout)
	}
	if running.httpServer.ReadTimeout != 0 || running.httpServer.WriteTimeout != 0 || running.httpServer.IdleTimeout != 0 {
		t.Fatalf("timeouts: read %s write %s idle %s", running.httpServer.ReadTimeout, running.httpServer.WriteTimeout, running.httpServer.IdleTimeout)
	}
}

func TestRejectionCutsOnARuneBoundary(t *testing.T) {
	var logBuffer bytes.Buffer
	handler := newTestServer(t, Configuration{LogOutput: &logBuffer}).Handler()
	request := httptest.NewRequest(http.MethodGet, loopbackURL+"/", nil)
	request.Host = strings.Repeat("あ", 80)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status: expected 403, actual %d", recorder.Code)
	}
	prefix := "rejected host: expected 127.0.0.1:47811 or localhost:47811 or the configured public host, actual "
	actual := strings.TrimPrefix(strings.TrimSuffix(recorder.Body.String(), "\n"), prefix)
	if !utf8.ValidString(actual) || len(actual) > 128 || len(actual)%len("あ") != 0 {
		t.Fatalf("cut host: %q (%d bytes)", actual, len(actual))
	}
	if !utf8.ValidString(strings.TrimPrefix(strings.TrimSuffix(logBuffer.String(), "\n"), prefix)) {
		t.Fatalf("log cut inside a rune: %q", logBuffer.String())
	}
}

func TestTerminalPageIsNotMarkedPassing(t *testing.T) {
	t.Skip("xterm を組み込んだ build を実機の iOS Safari とデスクトップで見ていない。docs/spec/security.md のブラウザの項目は合格にしない")
}
