// page_service.go と同じ core に置く。未知の view は JSON では enum の外を送れないので、手続きを直接呼ぶ。
// docs/spec/routes.md の「列挙」
//
//declscope:core
package api

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
)

func TestPageRejectsUnknownView(t *testing.T) {
	_, slug := newAPIWorkspace(t)
	view := yaruv1.IssueView(99)
	_, err := (pageService{}).GetPage(context.Background(), connect.NewRequest(&yaruv1.GetPageRequest{
		Workspace: slug,
		View:      &view,
	}))
	expectConnect(t, err, connect.CodeInvalidArgument, "invalid view: expected list or board, actual 99")
}
