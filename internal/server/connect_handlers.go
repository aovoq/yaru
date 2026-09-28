//declscope:core

package server

import (
	"mime"
	"net/http"
	"strings"

	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
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
	issueHandler := configuration.Handlers.Issue
	if issueHandler == nil {
		issueHandler = yaruv1connect.UnimplementedIssueServiceHandler{}
	}
	commentHandler := configuration.Handlers.Comment
	if commentHandler == nil {
		commentHandler = yaruv1connect.UnimplementedCommentServiceHandler{}
	}
	questionHandler := configuration.Handlers.Question
	if questionHandler == nil {
		questionHandler = yaruv1connect.UnimplementedQuestionServiceHandler{}
	}
	pageHandler := configuration.Handlers.Page
	if pageHandler == nil {
		pageHandler = yaruv1connect.UnimplementedPageServiceHandler{}
	}
	dashboardHandler := configuration.Handlers.Dashboard
	if dashboardHandler == nil {
		dashboardHandler = yaruv1connect.UnimplementedDashboardServiceHandler{}
	}
	projectHandler := configuration.Handlers.Project
	if projectHandler == nil {
		projectHandler = yaruv1connect.UnimplementedProjectServiceHandler{}
	}
	inboxHandler := configuration.Handlers.Inbox
	if inboxHandler == nil {
		inboxHandler = yaruv1connect.UnimplementedInboxServiceHandler{}
	}
	watchHandler := configuration.Handlers.Watch
	if watchHandler == nil {
		watchHandler = &workspaceWatchService{pollInterval: configuration.WatchPoll, heartbeat: configuration.Heartbeat}
	}
	issuePath, issueHTTP := yaruv1connect.NewIssueServiceHandler(issueHandler)
	commentPath, commentHTTP := yaruv1connect.NewCommentServiceHandler(commentHandler)
	questionPath, questionHTTP := yaruv1connect.NewQuestionServiceHandler(questionHandler)
	pagePath, pageHTTP := yaruv1connect.NewPageServiceHandler(pageHandler)
	dashboardPath, dashboardHTTP := yaruv1connect.NewDashboardServiceHandler(dashboardHandler)
	projectPath, projectHTTP := yaruv1connect.NewProjectServiceHandler(projectHandler)
	inboxPath, inboxHTTP := yaruv1connect.NewInboxServiceHandler(inboxHandler)
	watchPath, watchHTTP := yaruv1connect.NewWatchServiceHandler(watchHandler)
	mux.Handle(issuePath, issueHTTP)
	mux.Handle(commentPath, commentHTTP)
	mux.Handle(questionPath, questionHTTP)
	mux.Handle(pagePath, pageHTTP)
	mux.Handle(dashboardPath, dashboardHTTP)
	mux.Handle(projectPath, projectHTTP)
	mux.Handle(inboxPath, inboxHTTP)
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
