// 手続きの workspace は登録の slug。ヘッダにはしない。
// docs/spec/routes.md の「SPA と Connect への対応」、src/web.tsx:564-574
//
//declscope:core
package api

import (
	"fmt"

	"github.com/aovoq/yaru/internal/workspace"
)

func openBySlug(slug string) (workspace.Workspace, error) {
	registered, found := workspace.Find(slug, workspace.StateDirectory())
	if !found {
		return workspace.Workspace{}, fmt.Errorf("workspace not found: %s", slug)
	}
	return workspace.Open(registered.Root)
}
