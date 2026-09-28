// 1 つの手続きでは時計を 1 回だけ読む。docs/spec/routes.md の「サーバーの今」
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
//
//declscope:core
package api

import (
	"os"
	"time"

	"github.com/aovoq/yaru/internal/clock"
)

// readNow は HTTP 手続きの「今」。YARU_NOW があれば ParseYaruNow、無ければ time.Now。
// 空文字は未設定と区別する。エラー文言は invalid YARU_NOW のまま。
// docs/spec/routes.md の「サーバーの今」
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
func readNow() (time.Time, string, error) {
	value, exists := os.LookupEnv("YARU_NOW")
	if !exists {
		moment := time.Now()
		return moment, clock.ISOString(moment), nil
	}
	moment, err := clock.ParseYaruNow(value)
	if err != nil {
		return time.Time{}, "", err
	}
	return moment, clock.ISOString(moment), nil
}
