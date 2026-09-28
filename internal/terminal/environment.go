//declscope:core

package terminal

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// SessionEnvironment は試験用の herdr セッション名を読む環境変数
// 値は --session 引数にし、子の環境には入れない。リクエストからは読まない
// docs/spec/security.md の「決定 (2026-09-28)」。APP_HERDR_SESSION は読まない
const SessionEnvironment = "YARU_HERDR_SESSION"

// ChildEnvironment は herdr の子に渡す環境。親の環境は繋がない
// docs/spec/security.md の「herdr を起動するとき」。空の LANG も有無で見て、同じキーを 2 つにしない
// PTY でもそれ以外の起動でも TERM と COLORTERM を足す。docs/spec/security.md の「決定 (2026-09-28)」
// https://www.rfc-editor.org/rfc/rfc3875 は環境変数の形 KEY=VALUE
func ChildEnvironment(lookup func(string) (string, bool)) []string {
	keys := []string{"HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "SSH_AUTH_SOCK", "LANG", "LC_ALL", "LC_CTYPE"}
	environment := make([]string, 0, len(keys)+4)
	localePresent := false
	for _, key := range keys {
		value, exists := lookup(key)
		if !exists {
			continue
		}
		if key == "LANG" || key == "LC_ALL" || key == "LC_CTYPE" {
			// 空文字でもキーがあればロケールは設定済み。知らせコマンドと同じく有無で見る。
			localePresent = true
		}
		environment = append(environment, key+"="+value)
	}
	if !localePresent {
		environment = append(environment, "LANG=en_US.UTF-8")
	}
	userName, _ := lookup("USER")
	environment = append(environment,
		"PATH="+executableSearchPath(userName),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)
	return environment
}

// executableSearchPath は親の PATH を使わず、ログインに必要なディレクトリだけを並べる
// docs/spec/security.md の「herdr を起動するとき」。USER が空のときはユーザごとの 4 つを付けない
func executableSearchPath(userName string) string {
	base := "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
	if userName == "" {
		return base
	}
	return "/etc/profiles/per-user/" + userName + "/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/opt/homebrew/bin:" + base
}

// SessionArguments はサーバプロセスの環境だけから --session を作る
// 空と未設定は引数なし。クライアントのクエリやヘッダは見ない
// docs/spec/security.md の「決定 (2026-09-28)」。名前は YARU_HERDR_SESSION だけ
func SessionArguments(lookup func(string) (string, bool)) []string {
	name, exists := lookup(SessionEnvironment)
	if !exists || name == "" {
		return nil
	}
	return []string{"--session", name}
}

// HomeDirectory は子の作業ディレクトリ。HOME の値だけで、プロセスの現在ディレクトリは使わない
// docs/spec/security.md の「herdr を起動するとき」
func HomeDirectory(lookup func(string) (string, bool)) (string, error) {
	home, exists := lookup("HOME")
	if !exists || home == "" {
		return "", errors.New("herdr home is not set: expected a directory, actual empty")
	}
	if !filepath.IsAbs(home) {
		return "", fmt.Errorf("herdr home is not absolute: expected an absolute directory, actual %s", home)
	}
	return home, nil
}

func checkHomeDirectory(home string) error {
	info, err := os.Stat(home)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("herdr home is not a directory: expected a directory, actual %s", home)
	}
	return nil
}

func checkExecutable(executable string) error {
	if executable == "" {
		return errors.New("herdr executable is missing: expected a file, actual empty")
	}
	info, err := os.Stat(executable)
	if err != nil || info.IsDir() {
		return fmt.Errorf("herdr executable is missing: expected a file, actual %s", executable)
	}
	if info.Mode()&0o111 == 0 {
		return fmt.Errorf("herdr executable is not executable: expected an executable file, actual %s", executable)
	}
	return nil
}

// ResolveExecutable は herdr の実行ファイルを、リクエスト以外から探す
// HERDR_BIN、PATH 上の herdr、ユーザのプロフィールの順。herdr.go:34-45
// ハンドラはこれを呼ばない。サーバが結果を Config.HerdrExecutable に渡す
func ResolveExecutable(lookup func(string) (string, bool), lookPath func(string) (string, error), currentUserName func() (string, error)) string {
	if configured, exists := lookup("HERDR_BIN"); exists && configured != "" {
		return configured
	}
	if found, err := lookPath("herdr"); err == nil && found != "" {
		return found
	}
	userName, err := currentUserName()
	if err != nil || userName == "" {
		return ""
	}
	return "/etc/profiles/per-user/" + userName + "/bin/herdr"
}
