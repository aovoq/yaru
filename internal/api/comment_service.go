// コメントの一覧と保存。時刻は store が clock.Now を読む。返事に now は無い。
// src/web.tsx:385-393、src/store.ts:648-704、docs/spec/routes.md の「GET /api/comments」
//
//declscope:core
package api

import (
	"context"

	connect "connectrpc.com/connect"

	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/store"
)

type commentService struct{}

func (commentService) ListComments(ctx context.Context, request *connect.Request[yaruv1.ListCommentsRequest]) (*connect.Response[yaruv1.ListCommentsResponse], error) {
	_ = ctx
	if request.Msg.GetIssue() == "" {
		return nil, invalidArgument("issue is required when listing comments")
	}
	space, err := openBySlug(request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectError(err)
	}
	comments, err := store.ListComments(space.Directory, request.Msg.GetIssue())
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&yaruv1.ListCommentsResponse{Comments: commentMessages(comments)}), nil
}

func (commentService) SaveComment(ctx context.Context, request *connect.Request[yaruv1.SaveCommentRequest]) (*connect.Response[yaruv1.SaveCommentResponse], error) {
	_ = ctx
	space, err := openBySlug(request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectError(err)
	}
	input := store.SaveCommentInput{}
	if request.Msg.Id != nil {
		input.ID = request.Msg.Id
	}
	if request.Msg.Issue != nil {
		input.Issue = request.Msg.Issue
	}
	if request.Msg.Parent != nil {
		input.Parent = request.Msg.Parent
	}
	if request.Msg.Body != nil {
		input.Body = request.Msg.Body
	}
	comment, err := store.SaveComment(space.Directory, input)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&yaruv1.SaveCommentResponse{Comment: commentMessage(comment)}), nil
}
