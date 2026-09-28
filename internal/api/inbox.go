//declscope:core
package api

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/workspace"
)

// inboxService は全部のワークスペースの答え待ちを 1 つに集める。
// proto/yaru/v1/inbox.proto 。src/web.tsx:558-560 、src/inbox.ts:36-65 。
type inboxService struct {
	stateDirectory string
}

type inboxEntry struct {
	Workspace string
	BasePath  string
	Href      string
	Anchor    string
	Question  questions.Question
}

func (service *inboxService) GetInbox(ctx context.Context, request *connect.Request[yaruv1.GetInboxRequest]) (*connect.Response[yaruv1.GetInboxResponse], error) {
	_ = request
	moment, now, err := readNow()
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	questionService := questions.NewService()
	entries := []inboxEntry{}
	workspaces := []*yaruv1.InboxWorkspace{}
	for _, registered := range workspace.List(ctx, service.stateDirectory) {
		opened, openErr := workspace.Open(ctx, registered.Root)
		if openErr != nil {
			return nil, connectStatus(openErr, nil)
		}
		listed, listErr := questionService.ListQuestions(ctx, questionDirectory(opened), questions.QuestionFilter{}, moment)
		if listErr != nil {
			return nil, connectStatus(listErr, nil)
		}
		awaiting := []questions.Question{}
		for _, question := range listed {
			if question.Status == "open" || question.Status == "expired" {
				awaiting = append(awaiting, question)
			}
		}
		awaitingCount, countErr := int32Count("awaiting", len(awaiting))
		if countErr != nil {
			return nil, connectStatus(countErr, nil)
		}
		basePath := workspaceBasePath(registered.Slug)
		workspaces = append(workspaces, &yaruv1.InboxWorkspace{
			Slug:     registered.Slug,
			BasePath: basePath,
			Awaiting: awaitingCount,
		})
		for _, question := range awaiting {
			entries = append(entries, inboxEntry{
				Workspace: registered.Slug,
				BasePath:  basePath,
				Href:      basePath + "/dashboard#q-" + EncodeURIComponent(question.ID),
				Anchor:    "q-" + registered.Slug + "-" + question.ID,
				Question:  question,
			})
		}
	}
	groups := questions.GroupAwaitingQuestions(entries, func(entry inboxEntry) questions.Question {
		return entry.Question
	})
	blocking, err := protoInboxItems(groups.Blocking)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	dueSoon, err := protoInboxItems(groups.DueSoon)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	noDeadline, err := protoInboxItems(groups.NoDeadline)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	proceeded, err := protoInboxItems(groups.Proceeded)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	return connect.NewResponse(&yaruv1.GetInboxResponse{
		Groups: &yaruv1.InboxGroups{
			Blocking:   blocking,
			DueSoon:    dueSoon,
			NoDeadline: noDeadline,
			Proceeded:  proceeded,
		},
		Workspaces: workspaces,
		Now:        now,
	}), nil
}

func protoInboxItems(entries []inboxEntry) ([]*yaruv1.InboxItem, error) {
	items := []*yaruv1.InboxItem{}
	for _, entry := range entries {
		question, err := questionMessage(entry.Question)
		if err != nil {
			return nil, err
		}
		items = append(items, &yaruv1.InboxItem{
			Workspace: entry.Workspace,
			BasePath:  entry.BasePath,
			Href:      entry.Href,
			Anchor:    entry.Anchor,
			Question:  question,
		})
	}
	return items, nil
}

// workspaceBasePath は /p/<slug> 。slug は encodeURIComponent する。
// src/inbox.ts:63-64 。https://url.spec.whatwg.org/#urlencoded-serializing
func workspaceBasePath(slug string) string {
	return "/p/" + EncodeURIComponent(slug)
}

// EncodeURIComponent は TS の encodeURIComponent。残す文字は A-Z a-z 0-9 - _ . ! ~ * ' ( ) 。
// CLI の hint と QuestionURL が同じ実装を使う。
// src/inbox.ts:49 、src/notify.ts:41 。https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
func EncodeURIComponent(value string) string {
	var builder strings.Builder
	for _, symbol := range []byte(value) {
		if isURIUnescaped(symbol) {
			builder.WriteByte(symbol)
			continue
		}
		fmt.Fprintf(&builder, "%%%02X", symbol)
	}
	return builder.String()
}

func isURIUnescaped(symbol byte) bool {
	switch {
	case symbol >= 'A' && symbol <= 'Z':
		return true
	case symbol >= 'a' && symbol <= 'z':
		return true
	case symbol >= '0' && symbol <= '9':
		return true
	default:
		return strings.ContainsRune("-_.!~*'()", rune(symbol))
	}
}
