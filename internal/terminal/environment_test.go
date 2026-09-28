//declscope:core

package terminal

import (
	"errors"
	"strings"
	"testing"
)

// docs/spec/security.md の「herdr を起動するとき」と「決定 (2026-09-28)」
// 元は ~/workspace/resident-app/herdr.go:215-234 と terminal.go:37-38

func TestChildEnvironmentKeepsAllowlistOnly(t *testing.T) {
	lookup := mapLookup(map[string]string{
		"HOME":                     "/Users/example",
		"USER":                     "example",
		"LOGNAME":                  "example",
		"SHELL":                    "/bin/zsh",
		"TMPDIR":                   "/tmp",
		"SSH_AUTH_SOCK":            "/tmp/ssh-agent.sock",
		"LANG":                     "ja_JP.UTF-8",
		"LC_ALL":                   "ja_JP.UTF-8",
		"APP_TOKEN":                "app-token-secret",
		"YARU_STATE_DIR":           "/tmp/state",
		"YARU_NOW":                 "2026-09-28T12:00:00.000Z",
		"YARU_HERDR_SESSION":       "yaru-terminal-test",
		"APP_HERDR_SESSION":        "production",
		"PATH":                     "/evil",
		"HERDR_SESSION":            "x",
		"HERDR_BIN":                "/evil/herdr",
		"HERDR_FOO":                "herdr-foo",
		"TMUX":                     "1",
		"TMUX_PANE":                "%0",
		"TMUX_TMPDIR":              "/tmux-tmp",
		"AWS_SECRET_ACCESS_KEY":    "aws-secret-value",
		"DBUS_SESSION_BUS_ADDRESS": "unix:path=/tmp/bus",
	})

	environment := ChildEnvironment(lookup)
	expected := []string{
		"HOME=/Users/example",
		"USER=example",
		"LOGNAME=example",
		"SHELL=/bin/zsh",
		"TMPDIR=/tmp",
		"SSH_AUTH_SOCK=/tmp/ssh-agent.sock",
		"LANG=ja_JP.UTF-8",
		"LC_ALL=ja_JP.UTF-8",
		"PATH=/etc/profiles/per-user/example/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	}
	if strings.Join(environment, "\n") != strings.Join(expected, "\n") {
		t.Fatalf("environment\n%s\nexpected\n%s", strings.Join(environment, "\n"), strings.Join(expected, "\n"))
	}
	forbidden := []string{
		"app-token-secret",
		"/tmp/state",
		"2026-09-28T12:00:00.000Z",
		"yaru-terminal-test",
		"production",
		"/evil",
		"herdr-foo",
		"aws-secret-value",
		"/tmp/bus",
		"TMUX",
		"HERDR_",
		"YARU_",
		"APP_",
		"AWS_",
	}
	text := strings.Join(environment, "\n")
	for _, marker := range forbidden {
		if strings.Contains(text, marker) {
			t.Fatalf("child environment contains %s:\n%s", marker, text)
		}
	}
}

func TestChildEnvironmentAddsLanguageWhenUnset(t *testing.T) {
	environment := ChildEnvironment(mapLookup(map[string]string{
		"HOME": "/Users/example",
		"USER": "example",
	}))
	assertEntry(t, environment, "LANG=en_US.UTF-8")
	assertEntry(t, environment, "TERM=xterm-256color")
	assertEntry(t, environment, "COLORTERM=truecolor")
	if countEntries(environment, "LANG=") != 1 {
		t.Fatalf("LANG entries = %d, environment %v", countEntries(environment, "LANG="), environment)
	}
}

func TestChildEnvironmentKeepsEmptyLanguageAndAddsFallback(t *testing.T) {
	// herdr.go:220-229 は、LANG が空文字で存在するとき LANG= を残し、Getenv が空なので en_US.UTF-8 も足す
	environment := ChildEnvironment(mapLookup(map[string]string{
		"LANG":     "",
		"LC_ALL":   "",
		"LC_CTYPE": "",
		"USER":     "example",
	}))
	if countEntries(environment, "LANG=") != 2 {
		t.Fatalf("LANG entries = %d, environment %v", countEntries(environment, "LANG="), environment)
	}
	if !containsEntry(environment, "LANG=") || !containsEntry(environment, "LANG=en_US.UTF-8") {
		t.Fatalf("environment %v", environment)
	}
}

func TestChildEnvironmentOmitsUserPrefixesWhenUserIsEmpty(t *testing.T) {
	environment := ChildEnvironment(mapLookup(map[string]string{
		"USER": "",
		"HOME": "/Users/example",
		"LANG": "C",
	}))
	assertEntry(t, environment, "USER=")
	assertEntry(t, environment, "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
	text := strings.Join(environment, "\n")
	if strings.Contains(text, "/etc/profiles/per-user/") || strings.Contains(text, "/opt/homebrew/bin") {
		t.Fatalf("empty USER still added profile paths: %s", text)
	}
}

func TestSessionArgumentsComeFromServerEnvironmentOnly(t *testing.T) {
	if arguments := SessionArguments(mapLookup(nil)); arguments != nil {
		t.Fatalf("arguments = %v", arguments)
	}
	if arguments := SessionArguments(mapLookup(map[string]string{SessionEnvironment: ""})); arguments != nil {
		t.Fatalf("arguments = %v", arguments)
	}
	arguments := SessionArguments(mapLookup(map[string]string{
		SessionEnvironment:  "yaru-terminal-test",
		"APP_HERDR_SESSION": "production",
	}))
	expected := []string{"--session", "yaru-terminal-test"}
	if strings.Join(arguments, "\n") != strings.Join(expected, "\n") {
		t.Fatalf("arguments = %v", arguments)
	}
	if SessionEnvironment != "YARU_HERDR_SESSION" {
		t.Fatalf("session environment = %s", SessionEnvironment)
	}
}

func TestHomeDirectoryIsAbsoluteHomeOnly(t *testing.T) {
	home, err := HomeDirectory(mapLookup(map[string]string{"HOME": "/Users/example"}))
	if err != nil {
		t.Fatal(err)
	}
	if home != "/Users/example" {
		t.Fatalf("home = %s", home)
	}
	if _, err := HomeDirectory(mapLookup(nil)); err == nil || err.Error() != "herdr home is not set: expected a directory, actual empty" {
		t.Fatalf("unset home error = %v", err)
	}
	if _, err := HomeDirectory(mapLookup(map[string]string{"HOME": ""})); err == nil || err.Error() != "herdr home is not set: expected a directory, actual empty" {
		t.Fatalf("empty home error = %v", err)
	}
	if _, err := HomeDirectory(mapLookup(map[string]string{"HOME": "relative"})); err == nil || err.Error() != "herdr home is not absolute: expected an absolute directory, actual relative" {
		t.Fatalf("relative home error = %v", err)
	}
}

func TestResolveExecutableDoesNotUseRequest(t *testing.T) {
	lookPathCalls := 0
	lookPath := func(file string) (string, error) {
		lookPathCalls++
		if file != "herdr" {
			t.Fatalf("lookPath file = %s", file)
		}
		return "/usr/bin/herdr", nil
	}
	currentUserName := func() (string, error) {
		return "example", nil
	}
	if got := ResolveExecutable(mapLookup(map[string]string{"HERDR_BIN": "/opt/herdr"}), lookPath, currentUserName); got != "/opt/herdr" || lookPathCalls != 0 {
		t.Fatalf("configured = %s, lookPath calls = %d", got, lookPathCalls)
	}
	if got := ResolveExecutable(mapLookup(map[string]string{"HERDR_BIN": ""}), lookPath, currentUserName); got != "/usr/bin/herdr" || lookPathCalls != 1 {
		t.Fatalf("empty HERDR_BIN = %s, lookPath calls = %d", got, lookPathCalls)
	}
	failingLookPath := func(string) (string, error) {
		return "", errors.New("not found")
	}
	if got := ResolveExecutable(mapLookup(nil), failingLookPath, currentUserName); got != "/etc/profiles/per-user/example/bin/herdr" {
		t.Fatalf("fallback = %s", got)
	}
	if got := ResolveExecutable(mapLookup(nil), failingLookPath, func() (string, error) {
		return "", errors.New("no user")
	}); got != "" {
		t.Fatalf("unresolved = %s", got)
	}
}

func mapLookup(values map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		value, exists := values[key]
		return value, exists
	}
}

func assertEntry(t *testing.T, environment []string, entry string) {
	t.Helper()
	if !containsEntry(environment, entry) {
		t.Fatalf("missing %s in %v", entry, environment)
	}
}

func containsEntry(environment []string, entry string) bool {
	for _, candidate := range environment {
		if candidate == entry {
			return true
		}
	}
	return false
}

func countEntries(environment []string, prefix string) int {
	count := 0
	for _, entry := range environment {
		if strings.HasPrefix(entry, prefix) {
			count++
		}
	}
	return count
}
