// プロジェクト一覧。config.yml が無い登録は除き、登録順のまま返す。
// src/web.tsx:593-609、src/workspaces.ts:43-46、docs/spec/routes.md の「GET /」
//
//declscope:core
package api

import (
	"context"

	connect "connectrpc.com/connect"

	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

type projectService struct{}

func (projectService) ListProjects(ctx context.Context, request *connect.Request[yaruv1.ListProjectsRequest]) (*connect.Response[yaruv1.ListProjectsResponse], error) {
	_ = request
	moment, now, err := readNow()
	if err != nil {
		return nil, connectError(err)
	}
	questionService := questions.NewService()
	registered := workspace.List(ctx, stateDirectory())
	projects := make([]*yaruv1.Project, 0, len(registered))
	for _, entry := range registered {
		space, openErr := workspace.Open(ctx, entry.Root)
		if openErr != nil {
			return nil, connectError(openErr)
		}
		directory := questions.Directory{Dir: space.Directory}
		loaded, listErr := questionService.ListQuestions(ctx, directory, questions.QuestionFilter{}, moment)
		if listErr != nil {
			return nil, connectError(listErr)
		}
		awaiting := make([]questions.Question, 0)
		for _, question := range loaded {
			if question.Status == "open" || question.Status == "expired" {
				awaiting = append(awaiting, question)
			}
		}
		awaitingMessages, convertErr := questionMessages(awaiting)
		if convertErr != nil {
			return nil, connectError(convertErr)
		}
		inProgress, issueErr := store.ListIssues(ctx, space, store.Filter{Status: store.Present("in_progress")}, moment, workspace.GitName(ctx, space.Root))
		if issueErr != nil {
			return nil, connectError(issueErr)
		}
		count, countErr := int32Count("in_progress", len(inProgress))
		if countErr != nil {
			return nil, connectError(countErr)
		}
		projects = append(projects, &yaruv1.Project{
			Slug:       entry.Slug,
			Root:       entry.Root,
			Awaiting:   awaitingMessages,
			InProgress: count,
		})
	}
	return connect.NewResponse(&yaruv1.ListProjectsResponse{Projects: projects, Now: now}), nil
}
