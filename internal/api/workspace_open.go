// 手続きの workspace は登録の slug。ヘッダにはしない。
// docs/spec/routes.md の「SPA と Connect への対応」、src/web.tsx:564-574
//
//declscope:core
package api

import (
	"context"
	"fmt"
	"os"
	"os/user"

	"github.com/aovoq/yaru/internal/workspace"
)

func openBySlug(ctx context.Context, slug string) (workspace.Workspace, error) {
	registered, found := workspace.Find(ctx, slug, stateDirectory())
	if !found {
		return workspace.Workspace{}, fmt.Errorf("workspace not found: %s", slug)
	}
	return workspace.Open(ctx, registered.Root)
}

// stateDirectory は、状態ディレクトリの文字列をまだ持っていない手続きが使う。
// 既に文字列を持っている手続きは、その文字列を Find と List に渡す。
// src/workspaces.ts:18-21
// https://specifications.freedesktop.org/basedir-spec/latest/
//
//declscope:package
func stateDirectory() string {
	return workspace.StateDirectory(os.Getenv("YARU_STATE_DIR"), os.Getenv("XDG_STATE_HOME"), homeDirectory())
}

// homeDirectory は HOME が空でなければそれ、無ければユーザーの home、失敗なら空。
// os.UserHomeDir は HOME が空だと失敗するので、cli と同じく user.Current に戻す。
// https://pubs.opengroup.org/onlinepubs/9699919799/functions/getpwuid.html
func homeDirectory() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	current, err := user.Current()
	if err != nil {
		return ""
	}
	return current.HomeDir
}
