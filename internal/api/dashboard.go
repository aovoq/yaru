//declscope:core
package api

import (
	"context"

	"connectrpc.com/connect"
	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/repository"
	"github.com/aovoq/yaru/internal/sessions"
	"github.com/aovoq/yaru/internal/store"
)

// dashboardService は dashboard が 1 度に読む質問、issue、セッション、git。
// proto/yaru/v1/dashboard.proto 。src/web.tsx:424-446 、src/dashboard.tsx:35-52 。
type dashboardService struct {
	stateDirectory string
}

func (service *dashboardService) GetDashboard(ctx context.Context, request *connect.Request[yaruv1.GetDashboardRequest]) (*connect.Response[yaruv1.GetDashboardResponse], error) {
	moment, err := clock.Now()
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	opened, err := openRegistered(service.stateDirectory, request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	listedQuestions, err := questions.ListQuestions(questionDirectory(opened), questions.QuestionFilter{}, &moment)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	convertedQuestions, err := protoQuestions(listedQuestions)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	listedIssues, err := store.ListIssues(opened, store.Filter{}, &moment)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	convertedIssues, err := protoIssues(listedIssues)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	health, err := sessions.ReadSessionHealth(opened.Root, sessions.HealthOptions{Now: &moment})
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	convertedHealth, err := protoSessionHealth(health)
	if err != nil {
		return nil, connectStatus(err, nil)
	}
	state, err := repository.ReadRepositoryState(opened.Root)
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
		Now:           clock.ISOString(moment),
	}), nil
}
