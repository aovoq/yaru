// yaru serve の待受。TS 版の src/web.tsx の serve
// ホストは 127.0.0.1。既にその port で待っているときはエラーにせず、待受中である旨を出して戻る (src/web.tsx:612-635)
package server

// DefaultPort はフラグを省いたときの待受ポート。src/web.tsx:46
const DefaultPort = 47800

// Serve は port で待ち受ける。プロセスが終わるまでブロックしてよい。既に使用中なら nil を返す
func Serve(port int) error {
	panic("not implemented: server.Serve")
}
