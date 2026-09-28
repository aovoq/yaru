//declscope:core
package api

import (
	"context"

	"connectrpc.com/connect"
	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/repository"
	"github.com/aovoq/yaru/internal/sessions"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

// dashboardService は dashboard が 1 度に読む質問、issue、セッション、git。
// proto/yaru/v1/dashboard.proto 。src/web.tsx:424-446 、src/dashboard.tsx:35-52 。
type dashboardService struct {
	stateDirectory string
}

func (service *dashboardService) GetDashboard(ctx context.Context, request *connect.Request[yaruv1.GetDashboardRequest]) (*connect.Response[yaruv1.GetDashboardResponse], error) {
	moment, now, err := readNow()
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	opened, err := openRegistered(ctx, service.stateDirectory, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	questionService := questions.NewService()
	listedQuestions, err := questionService.ListQuestions(ctx, questionDirectory(opened), questions.QuestionFilter{}, moment)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	convertedQuestions, err := questionMessages(listedQuestions)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	listedIssues, err := store.ListIssues(ctx, opened, store.Filter{}, moment, workspace.GitName(ctx, opened.Root))
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	convertedIssues, err := issueMessages(listedIssues)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	reader := sessions.NewReader()
	health, err := reader.ReadHealth(ctx, opened.Root, sessions.HealthOptions{Home: homeDirectory(), Now: moment})
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	convertedHealth, err := protoSessionHealth(health)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	state, err := repository.ReadRepositoryState(ctx, opened.Root)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	convertedRepository, err := protoRepository(state)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	return connect.NewResponse(&yaruv1.GetDashboardResponse{
		Questions:     convertedQuestions,
		Issues:        convertedIssues,
		SessionHealth: convertedHealth,
		Repository:    convertedRepository,
		Now:           now,
	}), nil
}
