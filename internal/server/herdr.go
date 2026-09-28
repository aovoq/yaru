//declscope:core

package server

import (
	"errors"
	"os"
	"os/exec"
	"strings"
)

// herdr に渡す環境は許可リストだけ。親の環境をそのまま繋がない。
// TERM と COLORTERM は、決定に従い PTY でも CLI でも同じにする。
// docs/spec/security.md の「herdr を起動するとき」と「決定」
var herdrKeptNames = []string{
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"TMPDIR",
	"SSH_AUTH_SOCK",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
}

// HerdrCommand は herdr の子プロセスを作る。実行ファイル、引数、環境、作業ディレクトリはリクエストから受け取らない。
// APP_HERDR_SESSION はサーバの環境からだけ読み、子の環境には入れず、--session 引数にする。
func (server *Server) HerdrCommand(kind HerdrLaunchKind) (*exec.Cmd, error) {
	switch kind {
	case HerdrLaunchPTY, HerdrLaunchCLI:
	default:
		return nil, errors.New("herdr launch: expected pty or cli, actual unknown")
	}
	if server.configuration.HerdrExecutable == "" {
		return nil, errors.New("herdr executable is not configured: expected a path, actual empty")
	}
	parent := os.Environ()
	values := environmentMap(parent)
	arguments := append([]string{}, server.configuration.HerdrArguments...)
	if session := values["APP_HERDR_SESSION"]; session != "" {
		arguments = append(arguments, "--session", session)
	}
	command := exec.Command(server.configuration.HerdrExecutable, arguments...)
	command.Env = herdrEnvironment(values)
	command.Dir = values["HOME"]
	command.Path = server.configuration.HerdrExecutable
	return command, nil
}

func environmentMap(parent []string) map[string]string {
	values := make(map[string]string, len(parent))
	for _, entry := range parent {
		name, value, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		if _, exists := values[name]; exists {
			continue
		}
		values[name] = value
	}
	return values
}

func herdrEnvironment(values map[string]string) []string {
	environment := make([]string, 0, len(herdrKeptNames)+3)
	for _, name := range herdrKeptNames {
		value, found := values[name]
		if !found {
			continue
		}
		environment = append(environment, name+"="+value)
	}
	_, hasLang := values["LANG"]
	_, hasAll := values["LC_ALL"]
	_, hasCtype := values["LC_CTYPE"]
	if !hasLang && !hasAll && !hasCtype {
		environment = append(environment, "LANG=en_US.UTF-8")
	}
	environment = append(environment, "PATH="+herdrPath(values["USER"]))
	// 決定: どの経路でも TERM と COLORTERM を同じにする。端末の PTY に揃える。
	environment = append(environment, "TERM=xterm-256color", "COLORTERM=truecolor")
	return environment
}

func herdrPath(userName string) string {
	rest := "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
	if userName == "" {
		return rest
	}
	return "/etc/profiles/per-user/" + userName + "/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/opt/homebrew/bin:" + rest
}
