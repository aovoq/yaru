// 1 つの手続きでは時計を 1 回だけ読む。docs/spec/routes.md の「サーバーの今」
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
//
//declscope:core
package api

import (
	"time"

	"github.com/aovoq/yaru/internal/clock"
)

func readNow() (time.Time, string, error) {
	moment, err := clock.Now()
	if err != nil {
		return time.Time{}, "", err
	}
	return moment, clock.ISOString(moment), nil
}
