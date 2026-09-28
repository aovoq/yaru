// yaru serve の入口。待受のログと、既に使われている port の扱いまではここ。
// HTTP の中身は別の担当。TS 版の src/web.tsx:612-635
package server

import (
	"errors"
	"fmt"
	"net"
	"syscall"
)

// DefaultPort はフラグを省いたときの待受ポート。src/web.tsx:46
const DefaultPort = 47800

// Serve は 127.0.0.1 で port を取る。既に使われていれば待受中と出して戻る。
// 取れたあとはプロセスを終わらせない。画面の応答はまだ無い。
func Serve(port int) error {
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		if errors.Is(err, syscall.EADDRINUSE) {
			fmt.Printf("yaru  already running  http://127.0.0.1:%d\n", port)
			return nil
		}
		return err
	}
	fmt.Printf("yaru  http://127.0.0.1:%d\n", port)
	return holdListener(listener)
}

// holdListener は port を握ったまま戻らない。HTTP の応答はまだ別の担当
func holdListener(listener net.Listener) error {
	<-make(chan struct{})
	return listener.Close()
}
