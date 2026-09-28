//declscope:core

package server

import (
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path"
	"strings"

	"github.com/aovoq/yaru/internal/terminal"
	"github.com/aovoq/yaru/internal/workspace"
	webfs "github.com/aovoq/yaru/web"
)

// fallbackIndexHTML は web/dist に index.html が無い間の SPA の殻。インラインの script と style は置かない。
// head の link は src/ui/document.tsx:31-51。script は外部ファイルだけ (docs/spec/security.md の「応答ヘッダー」)。
const fallbackIndexHTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>yaru</title>
<link rel="preload" href="/assets/inter-4.1.woff2" as="font" type="font/woff2" crossorigin="anonymous">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#010102">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="yaru">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`

type httpApplication struct {
	port          int
	publicHost    string
	configuration Configuration
	connectMux    *http.ServeMux
	dist          fs.FS
}

func (server *Server) build(port int) http.Handler {
	application := &httpApplication{
		port:          port,
		publicHost:    server.publicHost,
		configuration: server.configuration,
		connectMux:    newConnectMux(server.configuration),
		dist:          server.configuration.Dist,
	}
	if application.dist == nil {
		application.dist = embeddedDist()
	}
	return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		secured := &securedResponse{ResponseWriter: responseWriter}
		application.serve(secured, request)
	})
}

func embeddedDist() fs.FS {
	sub, err := fs.Sub(webfs.Dist, "dist")
	if err != nil {
		return emptyDist{}
	}
	return sub
}

type emptyDist struct{}

func (emptyDist) Open(name string) (fs.File, error) {
	return nil, fs.ErrNotExist
}

func (application *httpApplication) serve(responseWriter http.ResponseWriter, request *http.Request) {
	if message, allowed := authorize(request, application.port, application.publicHost); !allowed {
		reject(responseWriter, request, application.configuration.LogOutput, message)
		return
	}
	if isWebSocketUpgrade(request) && request.URL.Path == terminal.Path && application.configuration.WireServices {
		// Host と Origin は上の authorize が済ませている。端末の中身は internal/terminal。
		// docs/spec/security.md の「WebSocket」
		application.serveTerminal(responseWriter, request)
		return
	}
	if isWebSocketUpgrade(request) {
		application.serveWebSocket(responseWriter, request)
		return
	}
	if isConnectPath(request.URL.Path) {
		application.serveConnect(responseWriter, request)
		return
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeBody(responseWriter, request, http.StatusNotFound, plainTextUTF8, []byte("not found"))
		return
	}
	switch request.URL.Path {
	case "/":
		application.serveSPA(responseWriter, request)
	case "/inbox":
		application.serveSPA(responseWriter, request)
	case "/terminal":
		application.serveTerminalDocument(responseWriter, request)
	case "/manifest.webmanifest":
		application.serveManifest(responseWriter, request)
	case "/icon.svg":
		application.serveIconSVG(responseWriter, request)
	case "/apple-touch-icon.png":
		application.servePNG(responseWriter, request, "apple-touch-icon.png")
	case "/icon-192.png":
		application.servePNG(responseWriter, request, "icon-192.png")
	case "/icon-512.png":
		application.servePNG(responseWriter, request, "icon-512.png")
	case "/icon-maskable-512.png":
		application.servePNG(responseWriter, request, "icon-maskable-512.png")
	case fontPath:
		application.serveFont(responseWriter, request)
	default:
		if slug, ok := workspacePageSlug(request.URL.Path); ok {
			application.serveWorkspacePage(responseWriter, request, slug)
			return
		}
		if application.serveStatic(responseWriter, request) {
			return
		}
		writeBody(responseWriter, request, http.StatusNotFound, plainTextUTF8, []byte("not found"))
	}
}

func (application *httpApplication) serveTerminal(responseWriter http.ResponseWriter, request *http.Request) {
	// Accept は Origin の host と Host の文字列比較をする。検査で正規化した Host に差し替える。
	// docs/spec/security.md の「WebSocket」。https://www.rfc-editor.org/rfc/rfc6455#section-1.6
	hostName, hostPort, allowed := classifyHost(request.Host, application.port, application.publicHost)
	if allowed {
		if hostPort == "" {
			request.Host = hostName
		} else {
			request.Host = hostName + ":" + hostPort
		}
	}
	executable := application.configuration.HerdrExecutable
	if executable == "" {
		executable = terminal.ResolveExecutable(os.LookupEnv, exec.LookPath, currentUserName)
	}
	terminal.Handler(terminal.Config{HerdrExecutable: executable}).ServeHTTP(responseWriter, request)
}

func (application *httpApplication) serveTerminalDocument(responseWriter http.ResponseWriter, request *http.Request) {
	// この path の文書だけ style-src に unsafe-inline を付ける。xterm 6 が style 要素を作るため。
	// docs/spec/security.md の「応答ヘッダー」。https://www.w3.org/TR/CSP3/#directive-style-src
	if secured, ok := responseWriter.(*securedResponse); ok {
		secured.policy = terminalContentSecurityPolicy
	}
	application.serveSPA(responseWriter, request)
}

func currentUserName() (string, error) {
	current, err := user.Current()
	if err != nil {
		return "", err
	}
	return current.Username, nil
}

func (application *httpApplication) serveWebSocket(responseWriter http.ResponseWriter, request *http.Request) {
	if application.configuration.WebSocket == nil {
		writeBody(responseWriter, request, http.StatusNotFound, plainTextUTF8, []byte("not found"))
		return
	}
	application.configuration.WebSocket.ServeHTTP(responseWriter, request)
}

// workspacePageSlug は SPA が受け取る /p/:slug、/p/:slug/、/p/:slug/dashboard。
// 末尾スラッシュの無い path は、登録された slug だけ板として開く。未知は 404 で、今の 302 はしない。
// docs/spec/routes.md の「SPA が受け取る path」
func workspacePageSlug(urlPath string) (string, bool) {
	if !strings.HasPrefix(urlPath, "/p/") {
		return "", false
	}
	rest := strings.TrimPrefix(urlPath, "/p/")
	slug, remainder, found := strings.Cut(rest, "/")
	if slug == "" || slug == "." || slug == ".." || strings.Contains(slug, "\\") {
		return "", false
	}
	if !found || remainder == "" || remainder == "dashboard" {
		return slug, true
	}
	return "", false
}

func (application *httpApplication) serveWorkspacePage(responseWriter http.ResponseWriter, request *http.Request, slug string) {
	if _, found := workspace.Find(slug, workspace.StateDirectory()); !found {
		message := "workspace not found: " + showHeaderValue(slug)
		writeBody(responseWriter, request, http.StatusNotFound, plainTextUTF8, []byte(message))
		return
	}
	application.serveSPA(responseWriter, request)
}

func (application *httpApplication) serveSPA(responseWriter http.ResponseWriter, request *http.Request) {
	body, found := readDistFile(application.dist, "index.html")
	if !found {
		body = []byte(fallbackIndexHTML)
	}
	writeBody(responseWriter, request, http.StatusOK, "text/html; charset=utf-8", body)
}

func (application *httpApplication) serveStatic(responseWriter http.ResponseWriter, request *http.Request) bool {
	name := strings.TrimPrefix(path.Clean("/"+request.URL.Path), "/")
	if name == "" || name == "." || strings.HasPrefix(name, ".") || strings.Contains(name, "..") {
		return false
	}
	base := path.Base(name)
	if strings.HasPrefix(base, ".") {
		return false
	}
	body, found := readDistFile(application.dist, name)
	if !found {
		return false
	}
	writeBody(responseWriter, request, http.StatusOK, staticContentType(name), body)
	return true
}

func readDistFile(dist fs.FS, name string) ([]byte, bool) {
	if dist == nil {
		return nil, false
	}
	file, err := dist.Open(name)
	if err != nil {
		return nil, false
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		return nil, false
	}
	body, err := io.ReadAll(file)
	if err != nil {
		return nil, false
	}
	return body, true
}

func staticContentType(name string) string {
	switch path.Ext(name) {
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".html":
		return "text/html; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".woff2":
		return "font/woff2"
	case ".json", ".map":
		return "application/json"
	case ".txt":
		return plainTextUTF8
	default:
		return "application/octet-stream"
	}
}
