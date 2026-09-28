//declscope:core

// Package api は質問、dashboard、受信箱の Connect ハンドラを返す。
// 登録は internal/server が行う。docs/spec/routes.md の「SPA と Connect への対応」。
package api

import (
	"net/http"

	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
)

// Handler は QuestionService、DashboardService、InboxService を 1 つの http.Handler に載せる。
// パスは /yaru.v1.QuestionService/ 、/yaru.v1.DashboardService/ 、/yaru.v1.InboxService/ 。
// docs/spec/routes.md の「手続き」。src/web.tsx:221-247 、src/web.tsx:424-446 、src/web.tsx:558-560 。
func Handler(stateDirectory string) http.Handler {
	mux := http.NewServeMux()
	questionPath, questionHandler := yaruv1connect.NewQuestionServiceHandler(&questionService{stateDirectory: stateDirectory})
	dashboardPath, dashboardHandler := yaruv1connect.NewDashboardServiceHandler(&dashboardService{stateDirectory: stateDirectory})
	inboxPath, inboxHandler := yaruv1connect.NewInboxServiceHandler(&inboxService{stateDirectory: stateDirectory})
	mux.Handle(questionPath, questionHandler)
	mux.Handle(dashboardPath, dashboardHandler)
	mux.Handle(inboxPath, inboxHandler)
	return mux
}
