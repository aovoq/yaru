// 接続ごとに herdr のクライアントを PTY で起動し、WebSocket と中継する
// 切断したらそのプロセスは残さない。herdr のサーバセッション自体は止めない
// 仕様は docs/spec/security.md の「WebSocket」と「herdr を起動するとき」
// 元は ~/workspace/resident-app/terminal.go:18-93 と herdr.go:207-234
// https://www.rfc-editor.org/rfc/rfc6455
//
//declscope:core
package terminal

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

// Path は端末の WebSocket。routes.md にはパスが無い。resident-app の Terminal.tsx:83 に合わせる
const Path = "/ws/terminal"

// Config はサーバが渡す設定。実行ファイルも公開 host も、リクエストからは取らない
type Config struct {
	HerdrExecutable string
	ListenPort      int
	PublicHost      string
}

type resizeMessage struct {
	Type    string `json:"type"`
	Columns uint16 `json:"cols"`
	Rows    uint16 `json:"rows"`
}

// Handler は /ws/terminal のアップグレードを受ける
// 検査に落ちたリクエストでは herdr を起動しない。docs/spec/security.md の「WebSocket」
func Handler(config Config) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		setSecurityHeaders(response)
		normalizedHost, authorizeError := AuthorizeWebSocket(request, config.ListenPort, config.PublicHost)
		if authorizeError != nil {
			writeText(response, http.StatusForbidden, authorizeError.Error())
			logRejection(authorizeError.Error())
			return
		}
		home, homeError := HomeDirectory(os.LookupEnv)
		if homeError != nil {
			writeText(response, http.StatusInternalServerError, homeError.Error())
			logRejection(homeError.Error())
			return
		}
		if directoryError := checkHomeDirectory(home); directoryError != nil {
			writeText(response, http.StatusInternalServerError, directoryError.Error())
			logRejection(directoryError.Error())
			return
		}
		if executableError := checkExecutable(config.HerdrExecutable); executableError != nil {
			writeText(response, http.StatusInternalServerError, executableError.Error())
			logRejection(executableError.Error())
			return
		}
		// Accept は Origin の host と Host の一致だけを見る (accept.go:239)。末尾のドットは落とさない
		// 検査を通した正規の Host に差し替えてから Accept する。InsecureSkipVerify と OriginPatterns は使わない
		// docs/spec/security.md の「WebSocket」
		request.Host = normalizedHost
		connection, acceptError := websocket.Accept(response, request, nil)
		if acceptError != nil {
			return
		}
		serveHerdr(connection, request, config, home)
	})
}

func serveHerdr(connection *websocket.Conn, request *http.Request, config Config, home string) {
	defer func() {
		if err := connection.CloseNow(); err != nil {
			return
		}
	}()
	connection.SetReadLimit(1 << 20)

	command := exec.Command(config.HerdrExecutable, SessionArguments(os.LookupEnv)...)
	command.Env = ChildEnvironment(os.LookupEnv)
	command.Dir = home
	window := &pty.Winsize{
		Cols: queryDimension(request, "cols", 80),
		Rows: queryDimension(request, "rows", 24),
	}
	ptyFile, startError := pty.StartWithSize(command, window)
	if startError != nil {
		if err := connection.Close(websocket.StatusInternalError, "herdr failed to start"); err != nil {
			return
		}
		if command.Process != nil {
			terminateProcess(command)
		}
		return
	}

	var stopOnce sync.Once
	stop := func() {
		stopOnce.Do(func() {
			closeError := ptyFile.Close()
			terminateProcess(command)
			if closeError != nil {
				return
			}
		})
	}
	defer stop()

	relayContext, cancel := context.WithCancel(context.Background())
	defer cancel()

	go copyPtyToWebSocket(relayContext, cancel, connection, ptyFile)

	for {
		messageType, data, readError := connection.Read(relayContext)
		if readError != nil {
			return
		}
		if messageType == websocket.MessageBinary {
			if _, writeError := ptyFile.Write(data); writeError != nil {
				return
			}
			continue
		}
		applyResize(ptyFile, data)
	}
}

func copyPtyToWebSocket(relayContext context.Context, cancel context.CancelFunc, connection *websocket.Conn, ptyFile *os.File) {
	defer cancel()
	buffer := make([]byte, 32*1024)
	for {
		count, readError := ptyFile.Read(buffer)
		if count > 0 {
			if writeError := connection.Write(relayContext, websocket.MessageBinary, buffer[:count]); writeError != nil {
				return
			}
		}
		if readError != nil {
			if err := connection.Close(websocket.StatusNormalClosure, "herdr exited"); err != nil {
				return
			}
			return
		}
	}
}

// applyResize はブラウザの大きさだけを PTY に伝える。それ以外のテキストは捨てる
// 入出力はログに残さない。形は ~/workspace/resident-app/terminal.go:83-88 と web/src/Terminal.tsx:73-75
// この JSON は保存しない。encoding/json の Encoder (HTML の escape と末尾の改行) は使わない
func applyResize(ptyFile *os.File, data []byte) {
	var message resizeMessage
	if err := json.Unmarshal(data, &message); err != nil {
		return
	}
	if message.Type != "resize" || message.Columns == 0 || message.Rows == 0 {
		return
	}
	if err := pty.Setsize(ptyFile, &pty.Winsize{Cols: message.Columns, Rows: message.Rows}); err != nil {
		return
	}
}

func queryDimension(request *http.Request, key string, defaultValue uint16) uint16 {
	parsed, err := strconv.ParseUint(request.URL.Query().Get(key), 10, 16)
	if err != nil || parsed == 0 {
		return defaultValue
	}
	return uint16(parsed)
}

func terminateProcess(command *exec.Cmd) {
	if command.Process == nil {
		return
	}
	processID := command.Process.Pid
	groupError := syscall.Kill(-processID, syscall.SIGTERM)
	if groupError != nil {
		if signalError := command.Process.Signal(syscall.SIGTERM); signalError != nil {
			groupError = signalError
		}
	}
	finished := make(chan struct{})
	go func() {
		if err := command.Wait(); err != nil {
			close(finished)
			return
		}
		close(finished)
	}()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	select {
	case <-finished:
	case <-timer.C:
		if err := syscall.Kill(-processID, syscall.SIGKILL); err != nil {
			if killError := command.Process.Kill(); killError != nil {
				<-finished
				return
			}
		}
		<-finished
	}
	if groupError != nil {
		return
	}
}
