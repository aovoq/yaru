// issue の読み書き。画面の保存は provenance を渡さない。
// src/web.tsx:358-383、src/store.ts:248-315、docs/spec/routes.md の「GET /api/issues」
//
//declscope:core
package api

import (
	"context"
	"fmt"

	connect "connectrpc.com/connect"

	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

type issueService struct{}

func (issueService) ListIssues(ctx context.Context, request *connect.Request[yaruv1.ListIssuesRequest]) (*connect.Response[yaruv1.ListIssuesResponse], error) {
	moment, now, err := readNow()
	if err != nil {
		return nil, connectError(err)
	}
	space, err := openBySlug(ctx, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectError(err)
	}
	filter, err := listFilter(request.Msg)
	if err != nil {
		return nil, connectError(err)
	}
	issues, err := store.ListIssues(ctx, space, filter, moment, workspace.GitName(ctx, space.Root))
	if err != nil {
		return nil, connectError(err)
	}
	messages, err := issueMessages(issues)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&yaruv1.ListIssuesResponse{Issues: messages, Now: now}), nil
}

func (issueService) GetIssue(ctx context.Context, request *connect.Request[yaruv1.GetIssueRequest]) (*connect.Response[yaruv1.GetIssueResponse], error) {
	moment, now, err := readNow()
	if err != nil {
		return nil, connectError(err)
	}
	space, err := openBySlug(ctx, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectError(err)
	}
	issue, err := store.GetIssue(ctx, space, request.Msg.GetId(), moment, workspace.GitName(ctx, space.Root))
	if err != nil {
		return nil, connectError(err)
	}
	message, err := issueMessage(issue)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&yaruv1.GetIssueResponse{Issue: message, Now: now}), nil
}

func (issueService) SaveIssue(ctx context.Context, request *connect.Request[yaruv1.SaveIssueRequest]) (*connect.Response[yaruv1.SaveIssueResponse], error) {
	moment, now, err := readNow()
	if err != nil {
		return nil, connectError(err)
	}
	space, err := openBySlug(ctx, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectError(err)
	}
	input, err := saveInput(request.Msg)
	if err != nil {
		return nil, connectError(err)
	}
	issue, err := store.SaveIssue(ctx, space, input, store.SaveOptions{Now: moment, Author: workspace.GitName(ctx, space.Root)})
	if err != nil {
		return nil, connectError(err)
	}
	message, err := issueMessage(issue)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&yaruv1.SaveIssueResponse{Issue: message, Now: now}), nil
}

func listFilter(request *yaruv1.ListIssuesRequest) (store.Filter, error) {
	filter := store.Filter{}
	if request.Status != nil && *request.Status != yaruv1.IssueStatus_ISSUE_STATUS_UNSPECIFIED {
		name, ok := statusName(*request.Status)
		if !ok {
			return store.Filter{}, fmt.Errorf("invalid status: expected %s, actual %s", store.JoinOr(store.Statuses()), enumActual(*request.Status))
		}
		filter.Status = store.Present(name)
	}
	if text, set := presentText(request.Assignee); set {
		filter.Assignee = store.Present(text)
	}
	if text, set := presentText(request.Label); set {
		filter.Label = store.Present(text)
	}
	if text, set := presentText(request.Query); set {
		filter.Query = store.Present(text)
	}
	if request.DueOverdue != nil && *request.DueOverdue {
		filter.Due = store.Present("overdue")
	}
	return filter, nil
}

func saveInput(request *yaruv1.SaveIssueRequest) (store.SaveInput, error) {
	input := store.SaveInput{}
	if request.Id != nil {
		input.ID = *request.Id
	}
	if request.Title != nil {
		input.Title = store.Present(*request.Title)
	}
	if request.Status != nil {
		if *request.Status == yaruv1.IssueStatus_ISSUE_STATUS_UNSPECIFIED {
			return store.SaveInput{}, fmt.Errorf("invalid status: expected %s, actual %s", store.JoinOr(store.Statuses()), enumActual(*request.Status))
		}
		name, ok := statusName(*request.Status)
		if !ok {
			return store.SaveInput{}, fmt.Errorf("invalid status: expected %s, actual %s", store.JoinOr(store.Statuses()), enumActual(*request.Status))
		}
		input.Status = store.Present(name)
	}
	if request.Assignee != nil {
		input.Assignee = store.Present(*request.Assignee)
	}
	if request.Labels != nil {
		input.Labels = store.Present(copyStrings(request.Labels.GetValues()))
	}
	if request.DueDate != nil {
		input.DueDate = store.Present(*request.DueDate)
	}
	if request.Priority != nil {
		if request.Priority.GetPriority() == yaruv1.IssuePriority_ISSUE_PRIORITY_UNSPECIFIED {
			input.Priority = store.Null[string]()
		} else {
			name, ok := priorityName(request.Priority.GetPriority())
			if !ok {
				return store.SaveInput{}, fmt.Errorf("invalid priority: expected %s, actual %s", store.JoinOr(store.Priorities()), enumActual(request.Priority.GetPriority()))
			}
			input.Priority = store.Present(name)
		}
	}
	if request.Parent != nil {
		input.Parent = store.Present(*request.Parent)
	}
	switch change := request.BlocksChange.(type) {
	case *yaruv1.SaveIssueRequest_Blocks:
		values := []string{}
		if change.Blocks != nil {
			values = copyStrings(change.Blocks.GetValues())
		}
		input.Blocks = store.Present(values)
	case *yaruv1.SaveIssueRequest_BlockDelta:
		if change.BlockDelta != nil {
			if change.BlockDelta.AddBlocks != nil {
				input.AddBlocks = store.Present(copyStrings(change.BlockDelta.AddBlocks.GetValues()))
			}
			if change.BlockDelta.RemoveBlocks != nil {
				input.RemoveBlocks = store.Present(copyStrings(change.BlockDelta.RemoveBlocks.GetValues()))
			}
			if change.BlockDelta.AddBlockedBy != nil {
				input.AddBlockedBy = store.Present(copyStrings(change.BlockDelta.AddBlockedBy.GetValues()))
			}
			if change.BlockDelta.RemoveBlockedBy != nil {
				input.RemoveBlockedBy = store.Present(copyStrings(change.BlockDelta.RemoveBlockedBy.GetValues()))
			}
		}
	}
	switch change := request.BodyChange.(type) {
	case *yaruv1.SaveIssueRequest_Body:
		input.Body = store.Present(change.Body)
	case *yaruv1.SaveIssueRequest_Patch:
		input.PatchSet = true
		input.Patch = patchOperations(change.Patch)
	}
	return input, nil
}

func presentText(value *string) (string, bool) {
	if value == nil || *value == "" {
		return "", false
	}
	return *value, true
}
