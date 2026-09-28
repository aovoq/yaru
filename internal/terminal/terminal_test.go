//declscope:core

package terminal

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// テストは一時ディレクトリの偽 herdr だけを起動する。本番の herdr セッションには触らない
// docs/spec/security.md の「テスト」と「herdr を起動するとき」
// 画面の経路は ~/workspace/resident-app/web/src/Terminal.tsx:73-87 と terminal.go:36-91

var fakeHerdrExecutable string

func TestMain(m *testing.M) {
	stateDirectory, err := os.MkdirTemp("", "yaru-terminal-state-")
	if err != nil {
		panic(err)
	}
	homeDirectory, err := os.MkdirTemp("", "yaru-terminal-home-")
	if err != nil {
		panic(err)
	}
	mustSetEnvironment("YARU_STATE_DIR", stateDirectory)
	mustSetEnvironment("HOME", homeDirectory)
	if err := os.Unsetenv("XDG_STATE_HOME"); err != nil {
		panic(err)
	}
	mustSetEnvironment("YARU_NOW", "2026-09-28T12:00:00.000Z")
	mustSetEnvironment("TZ", "Asia/Tokyo")
	mustSetEnvironment("GIT_CONFIG_GLOBAL", "/dev/null")
	mustSetEnvironment("GIT_CONFIG_NOSYSTEM", "1")
	mustSetEnvironment("GIT_AUTHOR_NAME", "Yaru Test")
	mustSetEnvironment("GIT_AUTHOR_EMAIL", "yaru-test@example.com")
	mustSetEnvironment("GIT_COMMITTER_NAME", "Yaru Test")
	mustSetEnvironment("GIT_COMMITTER_EMAIL", "yaru-test@example.com")
	mustSetEnvironment("YARU_PUBLIC_HOST", "")
	if err := os.Unsetenv(SessionEnvironment); err != nil {
		panic(err)
	}
	if err := os.Unsetenv("HERDR_BIN"); err != nil {
		panic(err)
	}
	fakeHerdrExecutable = buildFakeHerdr()
	rejectionLog = io.Discard
	code := m.Run()
	if err := os.RemoveAll(stateDirectory); err != nil {
		panic(err)
	}
	if err := os.RemoveAll(homeDirectory); err != nil {
		panic(err)
	}
	if err := os.RemoveAll(filepath.Dir(fakeHerdrExecutable)); err != nil {
		panic(err)
	}
	os.Exit(code)
}

func TestRelayPassesBytesSizeAndSession(t *testing.T) {
	homeDirectory := physicalDirectory(t, t.TempDir())
	otherDirectory := physicalDirectory(t, t.TempDir())
	t.Setenv("HOME", homeDirectory)
	t.Setenv("APP_TOKEN", "app-token-secret")
	t.Setenv("YARU_STATE_DIR", "/tmp/state")
	t.Setenv("PATH", "/evil")
	t.Setenv("HERDR_SESSION", "x")
	t.Setenv("HERDR_BIN", "/evil/herdr")
	t.Setenv("HERDR_FOO", "herdr-foo")
	t.Setenv("TMUX", "1")
	t.Setenv("TMUX_PANE", "%0")
	t.Setenv("TMUX_TMPDIR", "/tmux-tmp")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "aws-secret-value")
	t.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	t.Setenv(SessionEnvironment, "yaru-terminal-test")
	t.Setenv("APP_HERDR_SESSION", "production")
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/tmp/bus")
	t.Setenv("YARU_TERMINAL_SENTINEL", "sentinel-value")

	var logBuffer bytes.Buffer
	previousLog := rejectionLog
	rejectionLog = &logBuffer
	t.Cleanup(func() { rejectionLog = previousLog })

	started := startTerminal(t)
	query := "?cols=100&rows=40&token=secret&session=production&dir=" + otherDirectory + "&bin=/evil/herdr"
	connection := dialTerminal(t, started, query, started.loopbackOrigin(), "same-origin", "")
	processID := waitForClient(t, started.recordDirectory, nil)
	t.Cleanup(func() { killProcessGroup(processID) })

	if readTrimmed(t, started.clientPath(processID, "size")) != "40 100" {
		t.Fatalf("size = %s", readTrimmed(t, started.clientPath(processID, "size")))
	}
	if readTrimmed(t, started.clientPath(processID, "cwd")) != homeDirectory {
		t.Fatalf("cwd = %s, home = %s, other = %s", readTrimmed(t, started.clientPath(processID, "cwd")), homeDirectory, otherDirectory)
	}
	if readTrimmed(t, started.clientPath(processID, "argv0")) != fakeHerdrExecutable {
		t.Fatalf("argv0 = %s", readTrimmed(t, started.clientPath(processID, "argv0")))
	}
	arguments := readArguments(t, started.clientPath(processID, "args"))
	if strings.Join(arguments, "\n") != "--session\nyaru-terminal-test" {
		t.Fatalf("arguments = %v", arguments)
	}
	environmentText := readTrimmed(t, started.clientPath(processID, "env"))
	environment := parseEnvironment(environmentText)
	for _, marker := range []string{
		"app-token-secret", "/tmp/state", "/evil", "herdr-foo", "aws-secret-value",
		"2026-09-28T12:00:00.000Z", "yaru-terminal-test", "production", "sentinel-value",
		"unix:path=/tmp/bus", "token=secret", otherDirectory,
	} {
		if strings.Contains(environmentText, marker) {
			t.Fatalf("child environment contains %s:\n%s", marker, environmentText)
		}
	}
	for _, key := range []string{"APP_TOKEN", "YARU_STATE_DIR", "HERDR_SESSION", "HERDR_BIN", "HERDR_FOO", "TMUX", "TMUX_PANE", "TMUX_TMPDIR", "AWS_SECRET_ACCESS_KEY", "YARU_NOW", "YARU_HERDR_SESSION", "APP_HERDR_SESSION", "DBUS_SESSION_BUS_ADDRESS", "YARU_TERMINAL_SENTINEL"} {
		if _, exists := environment[key]; exists {
			t.Fatalf("child environment has %s", key)
		}
	}
	userName := os.Getenv("USER")
	expectedPath := "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
	if userName != "" {
		expectedPath = "/etc/profiles/per-user/" + userName + "/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/opt/homebrew/bin:" + expectedPath
	}
	if environment["PATH"] != expectedPath {
		t.Fatalf("PATH = %s", environment["PATH"])
	}
	if environment["TERM"] != "xterm-256color" || environment["COLORTERM"] != "truecolor" {
		t.Fatalf("TERM = %s COLORTERM = %s", environment["TERM"], environment["COLORTERM"])
	}
	if environment["HOME"] != homeDirectory {
		t.Fatalf("HOME = %s", environment["HOME"])
	}

	payload := []byte("ping-arbitrary\x03")
	writeContext, cancelWrite := context.WithTimeout(context.Background(), 2*time.Second)
	if err := connection.Write(writeContext, websocket.MessageBinary, payload); err != nil {
		cancelWrite()
		t.Fatal(err)
	}
	cancelWrite()
	received := readUntil(t, connection, payload)
	if !bytes.Equal(received, payload) {
		t.Fatalf("received = %q", received)
	}
	if strings.Contains(logBuffer.String(), "ping-arbitrary") || strings.Contains(logBuffer.String(), "secret") {
		t.Fatalf("log leaked terminal data: %q", logBuffer.String())
	}

	ignoreResize := []string{
		`{"type":"resize","cols":0,"rows":10}`,
		`not-json`,
		`{"type":"other","cols":10,"rows":10}`,
	}
	for _, message := range ignoreResize {
		writeContext, cancelWrite = context.WithTimeout(context.Background(), 2*time.Second)
		if err := connection.Write(writeContext, websocket.MessageText, []byte(message)); err != nil {
			cancelWrite()
			t.Fatal(err)
		}
		cancelWrite()
	}
	time.Sleep(100 * time.Millisecond)
	if readTrimmed(t, started.clientPath(processID, "size")) != "40 100" {
		t.Fatalf("size changed after ignored resize: %s", readTrimmed(t, started.clientPath(processID, "size")))
	}
	writeContext, cancelWrite = context.WithTimeout(context.Background(), 2*time.Second)
	if err := connection.Write(writeContext, websocket.MessageText, []byte(`{"type":"resize","cols":120,"rows":50}`)); err != nil {
		cancelWrite()
		t.Fatal(err)
	}
	cancelWrite()
	waitForSize(t, started.clientPath(processID, "size"), "50 120")

	if err := connection.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	waitUntilDead(t, processID)
}

func TestDisconnectOfOneClientLeavesTheOther(t *testing.T) {
	homeDirectory := physicalDirectory(t, t.TempDir())
	t.Setenv("HOME", homeDirectory)
	if err := os.Unsetenv(SessionEnvironment); err != nil {
		t.Fatal(err)
	}
	started := startTerminal(t)
	first := dialTerminal(t, started, "?cols=80&rows=24", started.loopbackOrigin(), "", "")
	firstProcessID := waitForClient(t, started.recordDirectory, nil)
	t.Cleanup(func() { killProcessGroup(firstProcessID) })
	second := dialTerminal(t, started, "", started.loopbackOrigin(), "same-origin", "")
	secondProcessID := waitForClient(t, started.recordDirectory, map[int]bool{firstProcessID: true})
	t.Cleanup(func() { killProcessGroup(secondProcessID) })
	if readTrimmed(t, started.clientPath(secondProcessID, "size")) != "24 80" {
		t.Fatalf("default size = %s", readTrimmed(t, started.clientPath(secondProcessID, "size")))
	}
	if arguments := readArguments(t, started.clientPath(firstProcessID, "args")); arguments != nil {
		t.Fatalf("arguments = %v", arguments)
	}
	if err := first.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	waitUntilDead(t, firstProcessID)
	if !processAlive(secondProcessID) {
		t.Fatal("second herdr client exited")
	}
	if err := second.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	waitUntilDead(t, secondProcessID)
}

func TestNormalizedHostAllowsWebSocket(t *testing.T) {
	// 大小文字と末尾のドットは server が正規化する。ハンドラは正規化済みの Host を受け取る。
	homeDirectory := physicalDirectory(t, t.TempDir())
	t.Setenv("HOME", homeDirectory)
	started := startTerminal(t)
	connection := dialTerminal(t, started, "?cols=80&rows=24", "https://mac.example.ts.net", "same-origin", "mac.example.ts.net")
	processID := waitForClient(t, started.recordDirectory, nil)
	t.Cleanup(func() { killProcessGroup(processID) })
	environmentText := readTrimmed(t, started.clientPath(processID, "env"))
	if strings.Contains(environmentText, "mac.example.ts.net") {
		t.Fatalf("request host leaked into environment:\n%s", environmentText)
	}
	if err := connection.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	waitUntilDead(t, processID)

	local := dialTerminal(t, started, "", "http://localhost:"+strconv.Itoa(started.port), "same-origin", "localhost:"+strconv.Itoa(started.port))
	localProcessID := waitForClient(t, started.recordDirectory, map[int]bool{processID: true})
	t.Cleanup(func() { killProcessGroup(localProcessID) })
	if err := local.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	waitUntilDead(t, localProcessID)
}

func TestInvalidColumnsUseDefaultSize(t *testing.T) {
	homeDirectory := physicalDirectory(t, t.TempDir())
	t.Setenv("HOME", homeDirectory)
	started := startTerminal(t)
	connection := dialTerminal(t, started, "?cols=0&rows=0", started.loopbackOrigin(), "", "")
	processID := waitForClient(t, started.recordDirectory, nil)
	t.Cleanup(func() { killProcessGroup(processID) })
	if readTrimmed(t, started.clientPath(processID, "size")) != "24 80" {
		t.Fatalf("size = %s", readTrimmed(t, started.clientPath(processID, "size")))
	}
	if err := connection.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	waitUntilDead(t, processID)
}

func TestPreconditionsFailBeforeStartingHerdr(t *testing.T) {
	cases := []struct {
		name       string
		home       string
		executable string
		want       string
	}{
		{name: "home empty", home: "", executable: fakeHerdrExecutable, want: "herdr home is not set: expected a directory, actual empty"},
		{name: "home relative", home: "relative-home", executable: fakeHerdrExecutable, want: "herdr home is not absolute: expected an absolute directory, actual relative-home"},
		{name: "executable empty", home: tDir(t), executable: "", want: "herdr executable is missing: expected a file, actual empty"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv("HOME", testCase.home)
			recordDirectory := t.TempDir()
			if err := os.WriteFile(fakeHerdrExecutable+".record", []byte(recordDirectory), 0o644); err != nil {
				t.Fatal(err)
			}
			handler := Handler(Config{HerdrExecutable: testCase.executable})
			request := httptest.NewRequest(http.MethodGet, "/ws/terminal", nil)
			request.Host = "127.0.0.1:47800"
			request.Header.Set("Origin", "http://127.0.0.1:47800")
			request.Header.Set("Upgrade", "websocket")
			request.Header.Set("Connection", "Upgrade")
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
			}
			if recorder.Body.String() != testCase.want {
				t.Fatalf("body = %q", recorder.Body.String())
			}
			assertHerdrNotStarted(t, recordDirectory)
		})
	}
}

func TestMissingHomeDirectoryDoesNotStartHerdr(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing")
	t.Setenv("HOME", missing)
	recordDirectory := t.TempDir()
	if err := os.WriteFile(fakeHerdrExecutable+".record", []byte(recordDirectory), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := Handler(Config{HerdrExecutable: fakeHerdrExecutable})
	request := httptest.NewRequest(http.MethodGet, "/ws/terminal", nil)
	request.Host = "127.0.0.1:47800"
	request.Header.Set("Origin", "http://127.0.0.1:47800")
	request.Header.Set("Upgrade", "websocket")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != "herdr home is not a directory: expected a directory, actual "+missing {
		t.Fatalf("body = %q", recorder.Body.String())
	}
	assertHerdrNotStarted(t, recordDirectory)
}

type startedTerminal struct {
	server          *httptest.Server
	port            int
	recordDirectory string
}

func (started startedTerminal) loopbackOrigin() string {
	return "http://127.0.0.1:" + strconv.Itoa(started.port)
}

func (started startedTerminal) clientPath(processID int, suffix string) string {
	return filepath.Join(started.recordDirectory, fmt.Sprintf("%d.%s", processID, suffix))
}

func startTerminal(t *testing.T) startedTerminal {
	t.Helper()
	recordDirectory := t.TempDir()
	if err := os.WriteFile(fakeHerdrExecutable+".record", []byte(recordDirectory), 0o644); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	tcpAddress, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("listener address = %T", listener.Addr())
	}
	handler := Handler(Config{HerdrExecutable: fakeHerdrExecutable})
	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)
	t.Cleanup(func() {
		matches, globError := filepath.Glob(filepath.Join(recordDirectory, "*.pid"))
		if globError != nil {
			return
		}
		for _, match := range matches {
			processID := readProcessID(t, match)
			killProcessGroup(processID)
		}
	})
	return startedTerminal{server: server, port: tcpAddress.Port, recordDirectory: recordDirectory}
}

func dialTerminal(t *testing.T, started startedTerminal, query string, origin string, secFetchSite string, host string) *websocket.Conn {
	t.Helper()
	header := http.Header{}
	if origin != "" {
		header.Set("Origin", origin)
	}
	if secFetchSite != "" {
		header.Set("Sec-Fetch-Site", secFetchSite)
	}
	dialContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	websocketURL := "ws://127.0.0.1:" + strconv.Itoa(started.port) + Path + query
	connection, response, err := websocket.Dial(dialContext, websocketURL, &websocket.DialOptions{
		Host:       host,
		HTTPHeader: header,
	})
	if err != nil {
		body := ""
		if response != nil && response.Body != nil {
			payload, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
			body = string(payload)
		}
		t.Fatalf("dial %s: %v body %s", websocketURL, err, body)
	}
	t.Cleanup(func() { _ = connection.Close(websocket.StatusNormalClosure, "") })
	if response.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d", response.StatusCode)
	}
	return connection
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

func waitForClient(t *testing.T, recordDirectory string, already map[int]bool) int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		matches, err := filepath.Glob(filepath.Join(recordDirectory, "*.pid"))
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range matches {
			processID := readProcessID(t, match)
			if already[processID] {
				continue
			}
			if _, err := os.Stat(filepath.Join(recordDirectory, fmt.Sprintf("%d.size", processID))); err == nil {
				return processID
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for fake herdr")
	return 0
}

func waitForSize(t *testing.T, path string, expected string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	last := ""
	for time.Now().Before(deadline) {
		last = readTrimmed(t, path)
		if last == expected {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("size = %q, expected %q", last, expected)
}

func waitUntilDead(t *testing.T, processID int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !processAlive(processID) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("process %d is still alive", processID)
}

func processAlive(processID int) bool {
	process, err := os.FindProcess(processID)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}

func killProcessGroup(processID int) {
	if processID <= 0 {
		return
	}
	_ = syscall.Kill(-processID, syscall.SIGKILL)
}

func readProcessID(t *testing.T, path string) int {
	t.Helper()
	processID, err := strconv.Atoi(readTrimmed(t, path))
	if err != nil {
		t.Fatal(err)
	}
	return processID
}

func readTrimmed(t *testing.T, path string) string {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(payload))
}

func readArguments(t *testing.T, path string) []string {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(bytes.TrimSpace(payload)) == 0 {
		return nil
	}
	return strings.Split(strings.TrimSuffix(string(payload), "\n"), "\n")
}

func readUntil(t *testing.T, connection *websocket.Conn, want []byte) []byte {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var received []byte
	for time.Now().Before(deadline) {
		readContext, cancel := context.WithTimeout(context.Background(), time.Until(deadline))
		_, payload, err := connection.Read(readContext)
		cancel()
		if err != nil {
			continue
		}
		received = append(received, payload...)
		if bytes.Equal(received, want) || bytes.Contains(received, want) {
			return received
		}
	}
	t.Fatalf("received %q, want %q", received, want)
	return nil
}

func parseEnvironment(text string) map[string]string {
	parsed := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		if line == "" {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		parsed[key] = value
	}
	return parsed
}

func physicalDirectory(t *testing.T, directory string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(directory)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

func tDir(t *testing.T) string {
	t.Helper()
	return physicalDirectory(t, t.TempDir())
}

func mustSetEnvironment(name string, value string) {
	if err := os.Setenv(name, value); err != nil {
		panic(err)
	}
}

func buildFakeHerdr() string {
	directory, err := os.MkdirTemp("", "yaru-fake-herdr-")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "go.mod"), []byte("module yaru-fake-herdr\n\ngo 1.26.7\n"), 0o644); err != nil {
		panic(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "main.go"), []byte(fakeHerdrSource), 0o644); err != nil {
		panic(err)
	}
	executable := filepath.Join(directory, "herdr")
	command := exec.Command("go", "build", "-o", executable, ".")
	command.Dir = directory
	command.Env = goBuildEnvironment()
	output, err := command.CombinedOutput()
	if err != nil {
		panic(fmt.Sprintf("build fake herdr: %v\n%s", err, output))
	}
	return executable
}

func goBuildEnvironment() []string {
	filtered := make([]string, 0, len(os.Environ())+2)
	for _, entry := range os.Environ() {
		if strings.HasPrefix(entry, "GOFLAGS=") || strings.HasPrefix(entry, "GOTOOLCHAIN=") {
			continue
		}
		filtered = append(filtered, entry)
	}
	return append(filtered, "GOTOOLCHAIN=local", "GO111MODULE=on")
}

const fakeHerdrSource = `package main

import (
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"unsafe"
)

type windowSize struct {
	Rows    uint16
	Columns uint16
	XPixels uint16
	YPixels uint16
}

func main() {
	executable, err := os.Executable()
	if err != nil {
		os.Exit(2)
	}
	recordBytes, err := os.ReadFile(executable + ".record")
	if err != nil {
		os.Exit(2)
	}
	recordDirectory := strings.TrimSpace(string(recordBytes))
	if err := os.MkdirAll(recordDirectory, 0o755); err != nil {
		os.Exit(2)
	}
	processID := os.Getpid()
	prefix := fmt.Sprintf("%s/%d", recordDirectory, processID)
	writeFile(prefix+".pid", fmt.Sprintf("%d\n", processID))
	writeFile(prefix+".argv0", os.Args[0]+"\n")
	writeFile(prefix+".args", strings.Join(os.Args[1:], "\n"))
	workingDirectory, err := syscall.Getwd()
	if err != nil {
		os.Exit(2)
	}
	writeFile(prefix+".cwd", workingDirectory+"\n")
	writeFile(prefix+".env", strings.Join(os.Environ(), "\n")+"\n")
	if err := setRaw(0); err != nil {
		os.Exit(3)
	}
	signals := make(chan os.Signal, 4)
	signal.Notify(signals, syscall.SIGWINCH)
	go func() {
		for range signals {
			writeFile(prefix+".size", currentSize())
		}
	}()
	writeFile(prefix+".size", currentSize())
	buffer := make([]byte, 4096)
	for {
		count, readErr := os.Stdin.Read(buffer)
		if count > 0 {
			if _, writeErr := os.Stdout.Write(buffer[:count]); writeErr != nil {
				os.Exit(0)
			}
		}
		if readErr != nil {
			os.Exit(0)
		}
	}
}

func setRaw(fd int) error {
	var termios syscall.Termios
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), uintptr(syscall.TIOCGETA), uintptr(unsafe.Pointer(&termios)))
	if errno != 0 {
		return errno
	}
	termios.Lflag &^= syscall.ECHO | syscall.ICANON | syscall.ISIG | syscall.IEXTEN
	termios.Iflag &^= syscall.ICRNL | syscall.INLCR | syscall.IGNCR | syscall.IXON
	termios.Oflag &^= syscall.OPOST
	termios.Cc[16] = 1
	termios.Cc[17] = 0
	_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), uintptr(syscall.TIOCSETA), uintptr(unsafe.Pointer(&termios)))
	if errno != 0 {
		return errno
	}
	return nil
}

func currentSize() string {
	var size windowSize
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, 0, uintptr(syscall.TIOCGWINSZ), uintptr(unsafe.Pointer(&size)))
	if errno != 0 {
		return fmt.Sprintf("errno %d\n", errno)
	}
	return fmt.Sprintf("%d %d\n", size.Rows, size.Columns)
}

func writeFile(path string, contents string) {
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, []byte(contents), 0o644); err != nil {
		os.Exit(2)
	}
	if err := os.Rename(temporary, path); err != nil {
		os.Exit(2)
	}
}
`
