//declscope:core

package server

import (
	"mime"
	"net/http"
	"strings"

	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
	"github.com/aovoq/yaru/internal/api"
	"github.com/aovoq/yaru/internal/workspace"
)

// connect-go の既定は Connect と gRPC と gRPC-Web を全部受ける。ここではメディアタイプを先に限り、
// application/grpc と application/grpc-web と application/connect+json 以外の connect+ は 415 にする。
// docs/spec/security.md の「Connect」
var allowedConnectMediaTypes = map[string]struct{}{
	"application/proto":         {},
	"application/json":          {},
	"application/connect+proto": {},
	"application/connect+json":  {},
}

func newConnectMux(configuration Configuration) *http.ServeMux {
	mux := http.NewServeMux()
	if configuration.WireServices {
		// 質問、dashboard、受信箱は 1 つの mux。パスは手続きのフルパスのまま。internal/api/handler.go
		questionServices := api.Handler(workspace.StateDirectory())
		mux.Handle("/yaru.v1.QuestionService/", questionServices)
		mux.Handle("/yaru.v1.DashboardService/", questionServices)
		mux.Handle("/yaru.v1.InboxService/", questionServices)
	}
	if configuration.Handlers.Issue != nil || !configuration.WireServices {
		issueHandler := configuration.Handlers.Issue
		if issueHandler == nil {
			issueHandler = yaruv1connect.UnimplementedIssueServiceHandler{}
		}
		issuePath, issueHTTP := yaruv1connect.NewIssueServiceHandler(issueHandler)
		mux.Handle(issuePath, issueHTTP)
	} else {
		mux.Handle(api.IssueMountPath, api.IssueHandler())
	}
	if configuration.Handlers.Comment != nil || !configuration.WireServices {
		commentHandler := configuration.Handlers.Comment
		if commentHandler == nil {
			commentHandler = yaruv1connect.UnimplementedCommentServiceHandler{}
		}
		commentPath, commentHTTP := yaruv1connect.NewCommentServiceHandler(commentHandler)
		mux.Handle(commentPath, commentHTTP)
	} else {
		mux.Handle(api.CommentMountPath, api.CommentHandler())
	}
	if configuration.Handlers.Page != nil || !configuration.WireServices {
		pageHandler := configuration.Handlers.Page
		if pageHandler == nil {
			pageHandler = yaruv1connect.UnimplementedPageServiceHandler{}
		}
		pagePath, pageHTTP := yaruv1connect.NewPageServiceHandler(pageHandler)
		mux.Handle(pagePath, pageHTTP)
	} else {
		mux.Handle(api.PageMountPath, api.PageHandler())
	}
	if configuration.Handlers.Project != nil || !configuration.WireServices {
		projectHandler := configuration.Handlers.Project
		if projectHandler == nil {
			projectHandler = yaruv1connect.UnimplementedProjectServiceHandler{}
		}
		projectPath, projectHTTP := yaruv1connect.NewProjectServiceHandler(projectHandler)
		mux.Handle(projectPath, projectHTTP)
	} else {
		mux.Handle(api.ProjectMountPath, api.ProjectHandler())
	}
	if configuration.Handlers.Question != nil || !configuration.WireServices {
		questionHandler := configuration.Handlers.Question
		if questionHandler == nil {
			questionHandler = yaruv1connect.UnimplementedQuestionServiceHandler{}
		}
		questionPath, questionHTTP := yaruv1connect.NewQuestionServiceHandler(questionHandler)
		mux.Handle(questionPath, questionHTTP)
	}
	if configuration.Handlers.Dashboard != nil || !configuration.WireServices {
		dashboardHandler := configuration.Handlers.Dashboard
		if dashboardHandler == nil {
			dashboardHandler = yaruv1connect.UnimplementedDashboardServiceHandler{}
		}
		dashboardPath, dashboardHTTP := yaruv1connect.NewDashboardServiceHandler(dashboardHandler)
		mux.Handle(dashboardPath, dashboardHTTP)
	}
	if configuration.Handlers.Inbox != nil || !configuration.WireServices {
		inboxHandler := configuration.Handlers.Inbox
		if inboxHandler == nil {
			inboxHandler = yaruv1connect.UnimplementedInboxServiceHandler{}
		}
		inboxPath, inboxHTTP := yaruv1connect.NewInboxServiceHandler(inboxHandler)
		mux.Handle(inboxPath, inboxHTTP)
	}
	watchHandler := configuration.Handlers.Watch
	if watchHandler == nil {
		watchHandler = &workspaceWatchService{pollInterval: configuration.WatchPoll, heartbeat: configuration.Heartbeat}
	}
	watchPath, watchHTTP := yaruv1connect.NewWatchServiceHandler(watchHandler)
	mux.Handle(watchPath, watchHTTP)
	return mux
}

func isConnectPath(urlPath string) bool {
	return strings.HasPrefix(urlPath, "/yaru.v1.")
}

func (application *httpApplication) serveConnect(responseWriter http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		// Host が許されないときは authorize が先に 403 を返す。ここは許された Host の GET など。
		// docs/spec/security.md の「Connect」
		message := "method not allowed: expected POST, actual " + request.Method
		writeBody(responseWriter, request, http.StatusMethodNotAllowed, plainTextUTF8, []byte(message))
		return
	}
	mediaType := connectMediaType(request.Header.Get("Content-Type"))
	if _, allowed := allowedConnectMediaTypes[mediaType]; !allowed {
		message := unsupportedContentTypeMessage(request.Header.Get("Content-Type"))
		writeBody(responseWriter, request, http.StatusUnsupportedMediaType, plainTextUTF8, []byte(message))
		return
	}
	if !contentTypeMatchesProcedure(request.URL.Path, mediaType) {
		message := contentTypeProcedureMessage(request.URL.Path, mediaType)
		writeBody(responseWriter, request, http.StatusBadRequest, plainTextUTF8, []byte(message))
		return
	}
	request.Header.Set("Content-Type", mediaType)
	application.connectMux.ServeHTTP(responseWriter, request)
}

func connectMediaType(headerValue string) string {
	if headerValue == "" {
		return ""
	}
	mediaType, _, err := mime.ParseMediaType(headerValue)
	if err != nil {
		return ""
	}
	return strings.ToLower(mediaType)
}

func contentTypeMatchesProcedure(urlPath string, mediaType string) bool {
	streaming := urlPath == yaruv1connect.WatchServiceWatchWorkspaceProcedure
	switch mediaType {
	case "application/json", "application/proto":
		return !streaming
	case "application/connect+json", "application/connect+proto":
		return streaming
	default:
		return false
	}
}

func unsupportedContentTypeMessage(actual string) string {
	shown := strings.TrimSpace(actual)
	if shown == "" {
		shown = "<empty>"
	} else {
		shown = showHeaderValue(shown)
	}
	return "unsupported content type: expected application/proto or application/json or application/connect+proto or application/connect+json, actual " + shown
}

func contentTypeProcedureMessage(urlPath string, mediaType string) string {
	expected := "application/json or application/proto"
	if urlPath == yaruv1connect.WatchServiceWatchWorkspaceProcedure {
		expected = "application/connect+json or application/connect+proto"
	}
	return "content type does not match procedure: expected " + expected + ", actual " + mediaType
}
