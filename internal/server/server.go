//declscope:core

// Package server は yaru serve の芯である。127.0.0.1 で待ち、ブラウザ向けの検査を通し、Connect の手続きを載せる。
// 各 RPC の中身は別の担当が差し込む。未実装のサービスは Unimplemented を返す。
// 仕様は docs/spec/security.md の「決定」と docs/spec/routes.md の「SPA と Connect への対応」。
// 既定ポートは src/web.tsx:46 と src/web.tsx:614-616。
package server

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/user"
	"strconv"
	"syscall"
	"time"

	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
	"github.com/aovoq/yaru/internal/api"
	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/workspace"
)

// DefaultPort はフラグを省いたときの待ち受けポート (src/web.tsx:46)。
const DefaultPort = 47800

// DefaultHeartbeat は Watch の heartbeat の間隔。今の SSE の ping は 5 秒 (src/web.tsx:332)。
const DefaultHeartbeat = 5 * time.Second

// DefaultWatchPoll は issues、questions、comments の変化を見る間隔。
// 接続のあとでできたディレクトリも見るため、スナップショットを比べる (docs/spec/routes.md の「ライブ更新」)。
const DefaultWatchPoll = 100 * time.Millisecond

// ErrAlreadyRunning は指定ポートが使用中のとき Start が返す。
// 標準出力には TS 版と同じ「already running」を書いてある (src/web.tsx:630-632)。終了コードを 0 にするかは呼び出し側が決める。
var ErrAlreadyRunning = errors.New("yaru already running")

// Handlers は Connect のサービス実装。nil のサービスは Unimplemented を返す。
// Watch が nil のときは、このパッケージのファイル監視を使う。
type Handlers struct {
	Issue     yaruv1connect.IssueServiceHandler
	Comment   yaruv1connect.CommentServiceHandler
	Question  yaruv1connect.QuestionServiceHandler
	Page      yaruv1connect.PageServiceHandler
	Dashboard yaruv1connect.DashboardServiceHandler
	Project   yaruv1connect.ProjectServiceHandler
	Inbox     yaruv1connect.InboxServiceHandler
	Watch     yaruv1connect.WatchServiceHandler
}

// Configuration はサーバの起動設定。公開 host はワークスペースのファイルからは取らない。
// docs/spec/security.md の「許可する Host」
type Configuration struct {
	// Port は 1 から 65535。0 は未指定で DefaultPort になる (src/index.ts:797-801)。
	Port int
	// Ephemeral が true のときは OS が空いているポートを選ぶ。テストが 47800 を掴まえないため。
	Ephemeral bool
	// PublicHost は --public-host。PublicHostSet が true のときだけ使い、環境変数より先に見る。
	PublicHost    string
	PublicHostSet bool
	// Heartbeat が 0 のときは DefaultHeartbeat。
	Heartbeat time.Duration
	// WatchPoll が 0 のときは DefaultWatchPoll。
	WatchPoll time.Duration
	Handlers  Handlers
	// WireServices が true のとき、internal/api の手続きと /ws/terminal を載せる。
	// nil の Handlers は未実装のままにするテストと分けている。docs/spec/routes.md の「SPA と Connect への対応」
	WireServices bool
	// WebSocket は Upgrade の検査を通ったあとで呼ぶ。nil のときは 404。/ws/terminal は WireServices が受け持つ。
	WebSocket http.Handler
	// LogOutput は 403 などのログ。nil のときは標準エラー。query と本文は書かない。
	LogOutput io.Writer
	// StartupOutput は「yaru  http://...」の行。nil のときは標準出力 (src/web.tsx:627)。
	StartupOutput io.Writer
	// Dist は SPA のファイル。nil のときは埋め込んだ web/dist。
	Dist fs.FS
	// HerdrExecutable は herdr の実行ファイル。リクエストからは受け取らない。
	HerdrExecutable string
}

// Server は検査と配信の設定を持つ。Start するまでポートは開かない。
type Server struct {
	configuration Configuration
	publicHost    string
	boundPort     int
}

// Running は待ち受け中のサーバ。
type Running struct {
	Port              int
	listener          net.Listener
	httpServer        *http.Server
	done              chan error
	stopNotifications func()
}

// ListenAddress は待ち受けるアドレス。検査に使うポートは、実際に bind したポート (docs/spec/security.md の「待ち受けと公開」)。
func ListenAddress(configuration Configuration) (string, error) {
	port, err := listenPort(configuration)
	if err != nil {
		return "", err
	}
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), nil
}

func listenPort(configuration Configuration) (int, error) {
	if configuration.Ephemeral {
		return 0, nil
	}
	port := configuration.Port
	if port == 0 {
		port = DefaultPort
	}
	if port < 1 || port > 65535 {
		// src/index.ts:800 の invalid port
		return 0, fmt.Errorf("invalid port: %d", port)
	}
	return port, nil
}

// stateDirectory は登録の slug を探す場所。api と同じ解決で、循環 import を避けるためこちらにも置く。
// src/workspaces.ts:18-21
// https://specifications.freedesktop.org/basedir-spec/latest/
func stateDirectory() string {
	return workspace.StateDirectory(os.Getenv("YARU_STATE_DIR"), os.Getenv("XDG_STATE_HOME"), homeDirectory())
}

// homeDirectory は HOME が空でなければそれ、無ければユーザーの home、失敗なら空。
// https://pubs.opengroup.org/onlinepubs/9699919799/functions/getpwuid.html
func homeDirectory() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	current, err := user.Current()
	if err != nil {
		return ""
	}
	return current.HomeDir
}

// New は YARU_NOW と公開 host を検査する。待ち受けはまだしない (src/web.tsx:613-615)。
func New(configuration Configuration) (*Server, error) {
	if configuration.LogOutput == nil {
		configuration.LogOutput = os.Stderr
	}
	if configuration.StartupOutput == nil {
		configuration.StartupOutput = os.Stdout
	}
	if configuration.Heartbeat <= 0 {
		configuration.Heartbeat = DefaultHeartbeat
	}
	if configuration.WatchPoll <= 0 {
		configuration.WatchPoll = DefaultWatchPoll
	}
	if value, exists := os.LookupEnv("YARU_NOW"); exists {
		if _, err := clock.ParseYaruNow(value); err != nil {
			return nil, err
		}
	}
	publicHost, err := resolvePublicHost(configuration)
	if err != nil {
		writeLine(configuration.LogOutput, err.Error())
		return nil, err
	}
	if _, err := listenPort(configuration); err != nil {
		return nil, err
	}
	return &Server{configuration: configuration, publicHost: publicHost}, nil
}

// Handler は HTTP の入口。ポートは設定値 (まだ bind していないとき) か、Start で bind したポート。
func (server *Server) Handler() http.Handler {
	return server.build(server.portNumber())
}

func (server *Server) portNumber() int {
	if server.boundPort != 0 {
		return server.boundPort
	}
	port, err := listenPort(server.configuration)
	if err != nil || port == 0 {
		return DefaultPort
	}
	return port
}

// Start は 127.0.0.1 だけで待つ。WriteTimeout は 0 (docs/spec/routes.md の「ライブ更新」)。
// 使用中なら TS 版と同じ行を書いて ErrAlreadyRunning を返す (src/web.tsx:627-632)。
func (server *Server) Start() (*Running, error) {
	restrictProcessLogFiles()
	address, err := ListenAddress(server.configuration)
	if err != nil {
		return nil, err
	}
	listener, err := listenTCP(address)
	if err != nil {
		if isAddressInUse(err) {
			message := fmt.Sprintf("yaru  already running  http://%s", hostPortForMessage(address))
			writeLine(server.configuration.StartupOutput, message)
			return nil, ErrAlreadyRunning
		}
		return nil, err
	}
	tcpAddress, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		_ = listener.Close()
		return nil, fmt.Errorf("listen address: expected a TCP address, actual %T", listener.Addr())
	}
	server.boundPort = tcpAddress.Port
	httpServer := &http.Server{
		Handler:     server.build(tcpAddress.Port),
		ReadTimeout: 0,
		// ヘッダを読み続けて待ち受けを塞がない。本文の ReadTimeout は 0 のまま。
		// docs/spec/security.md の「決定」。https://www.rfc-editor.org/rfc/rfc7230#section-3.2
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       0,
	}
	done := make(chan error, 1)
	go func() {
		serveErr := httpServer.Serve(listener)
		if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			writeLine(server.configuration.LogOutput, fmt.Sprintf("serve failed: %s", serveErr.Error()))
		}
		done <- serveErr
	}()
	writeLine(server.configuration.StartupOutput, fmt.Sprintf("yaru  http://127.0.0.1:%d", tcpAddress.Port))
	running := &Running{Port: tcpAddress.Port, listener: listener, httpServer: httpServer, done: done}
	if server.configuration.WireServices {
		// 期限と止まった issue の見回り。src/web.tsx:640-661 。公開 URL の頭は実際に bind したポート。
		baseURL := fmt.Sprintf("http://127.0.0.1:%d", tcpAddress.Port)
		running.stopNotifications = api.WatchNotifications(stateDirectory(), baseURL, func(line string) {
			writeLine(server.configuration.LogOutput, line)
		})
	}
	return running, nil
}

// Serve は CLI の yaru serve が呼ぶ入口。形は func(port int) error のまま。
// port は 1 から 65535 で、0 は既定の 47800。公開 host はフラグ、YARU_PUBLIC_HOST、tailscale の順 (New)。
// 使用中なら TS 版と同じくエラーにせず戻る (src/web.tsx:630-632)。起動できたら、プロセスが止まるまで待つ。
func Serve(port int) error {
	built, err := New(Configuration{Port: port, WireServices: true})
	if err != nil {
		return err
	}
	running, err := built.Start()
	if errors.Is(err, ErrAlreadyRunning) {
		return nil
	}
	if err != nil {
		return err
	}
	serveErr := running.Wait()
	if errors.Is(serveErr, http.ErrServerClosed) {
		return nil
	}
	return serveErr
}

// URL は実際に bind したループバックの URL。
func (running *Running) URL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", running.Port)
}

// Addr は bind したアドレス。127.0.0.1 であることをテストが確かめる。
func (running *Running) Addr() net.Addr {
	return running.listener.Addr()
}

// Close は待ち受けと、知らせの見回りを止める。
func (running *Running) Close() error {
	if running.stopNotifications != nil {
		running.stopNotifications()
	}
	return running.httpServer.Close()
}

// Wait は Serve が終わるまで待つ。Close のあとは nil を返す。
func (running *Running) Wait() error {
	if running.done == nil {
		return nil
	}
	return <-running.done
}

func hostPortForMessage(address string) string {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return address
	}
	return host + ":" + port
}

var listenTCP = func(address string) (net.Listener, error) {
	return net.Listen("tcp4", address)
}

func isAddressInUse(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE)
}

func writeLine(writer io.Writer, text string) {
	if writer == nil {
		return
	}
	_, _ = io.WriteString(writer, text)
	_, _ = io.WriteString(writer, "\n")
}

// restrictProcessLogFiles は、標準出力と標準エラーが通常ファイルならモードを 0600 にする。
// パスではなく開いているファイル記述子に対して行う。失敗してもサーバは落とさない。
// docs/spec/security.md の「ログ」
func restrictProcessLogFiles() {
	restrictLogFile(os.Stdout)
	restrictLogFile(os.Stderr)
}

func restrictLogFile(file *os.File) {
	if file == nil {
		return
	}
	info, err := file.Stat()
	if err != nil {
		reportChmodFailure(err)
		return
	}
	if !info.Mode().IsRegular() {
		return
	}
	if err := fchmod(int(file.Fd()), 0o600); err != nil {
		reportChmodFailure(err)
	}
}

func reportChmodFailure(cause error) {
	if !stderrIsTerminal(os.Stderr) {
		return
	}
	writeLine(os.Stderr, fmt.Sprintf("log file mode: expected 0600, actual chmod failed: %s", cause.Error()))
}

var fchmod = syscall.Fchmod

var stderrIsTerminal = func(file *os.File) bool {
	if file == nil {
		return false
	}
	info, err := file.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}
