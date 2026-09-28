//declscope:core

package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHerdrCommandFiltersTheEnvironment(t *testing.T) {
	home := t.TempDir()
	workspace := t.TempDir()
	scriptPath := filepath.Join(t.TempDir(), "herdr")
	script := "#!/bin/sh\n/bin/pwd -P\nprintf 'ARGS'\nprintf ' %s' \"$@\"\nprintf '\\n'\n/usr/bin/env\n"
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("USER", "yaru-user")
	t.Setenv("PATH", "/evil")
	t.Setenv("APP_TOKEN", "secret-token-value")
	t.Setenv("YARU_STATE_DIR", workspace)
	t.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	t.Setenv("HERDR_SESSION", "secret-session")
	t.Setenv("HERDR_BIN", "/evil/herdr")
	t.Setenv("TMUX", "1")
	t.Setenv("TMUX_PANE", "%0")
	t.Setenv("APP_HERDR_SESSION", "from-server")
	unsetForTest(t, "LANG")
	unsetForTest(t, "LC_ALL")
	unsetForTest(t, "LC_CTYPE")
	built := newTestServer(t, Configuration{
		HerdrExecutable: scriptPath,
		HerdrArguments:  []string{"workspace", "list"},
	})
	request := perform(built.Handler(), http.MethodGet, loopbackURL+"/?token=secret-request-token", loopbackHost, "", "", map[string]string{"X-Executable": "/evil/requested-herdr"})
	if request.Code != http.StatusOK {
		t.Fatal(request.Body.String())
	}
	pty, err := built.HerdrCommand(HerdrLaunchPTY)
	if err != nil {
		t.Fatal(err)
	}
	cli, err := built.HerdrCommand(HerdrLaunchCLI)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(pty.Env, "\n") != strings.Join(cli.Env, "\n") {
		t.Fatalf("pty and cli environments differ:\n%s\n%s", strings.Join(pty.Env, "\n"), strings.Join(cli.Env, "\n"))
	}
	output, err := pty.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, output)
	}
	text := string(output)
	physical, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	firstLine, _, _ := strings.Cut(text, "\n")
	if firstLine != physical && firstLine != home {
		t.Fatalf("cwd: expected %s, actual %s", home, firstLine)
	}
	if strings.Contains(firstLine, filepath.Base(workspace)) && home != workspace {
		t.Fatalf("cwd is the workspace: %s", firstLine)
	}
	expectedPath := "/etc/profiles/per-user/yaru-user/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
	if !strings.Contains(text, "PATH="+expectedPath) {
		t.Fatalf("path: %s", text)
	}
	for _, secret := range []string{"secret-token-value", "secret-session", "secret-request-token", "/evil", "YARU_STATE_DIR=", "YARU_NOW=", "HERDR_SESSION=", "HERDR_BIN=", "TMUX=", "TMUX_PANE=", "APP_HERDR_SESSION=", "APP_TOKEN="} {
		if strings.Contains(text, secret) {
			t.Fatalf("child output contains %s\n%s", secret, text)
		}
	}
	if !strings.Contains(text, "TERM=xterm-256color") || !strings.Contains(text, "COLORTERM=truecolor") {
		t.Fatalf("terminal variables: %s", text)
	}
	if !strings.Contains(text, "LANG=en_US.UTF-8") {
		t.Fatalf("default lang: %s", text)
	}
	if !strings.Contains(text, "ARGS workspace list --session from-server") {
		t.Fatalf("args: %s", text)
	}
	if pty.Path != scriptPath || strings.Contains(pty.Path, "requested-herdr") {
		t.Fatalf("executable: %s", pty.Path)
	}
}

func TestHerdrPathOmitsPerUserBinsWhenUserIsEmpty(t *testing.T) {
	t.Setenv("USER", "")
	t.Setenv("LC_CTYPE", "ja_JP.UTF-8")
	unsetForTest(t, "APP_HERDR_SESSION")
	scriptPath := filepath.Join(t.TempDir(), "herdr")
	if err := os.WriteFile(scriptPath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	built := newTestServer(t, Configuration{HerdrExecutable: scriptPath})
	command, err := built.HerdrCommand(HerdrLaunchCLI)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(command.Env, "\n")
	if !strings.Contains(joined, "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin") {
		t.Fatalf("path: %s", joined)
	}
	if strings.Contains(joined, "/etc/profiles/per-user") || strings.Contains(joined, "/opt/homebrew/bin") {
		t.Fatalf("empty user still has per-user bins: %s", joined)
	}
	if !strings.Contains(joined, "LC_CTYPE=ja_JP.UTF-8") {
		t.Fatalf("locale: %s", joined)
	}
	if strings.Contains(joined, "--session") {
		t.Fatalf("session argument without the server variable: %s", strings.Join(command.Args, " "))
	}
}
