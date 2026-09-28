// CLI とサーバーの「今」と、時刻の書き方。TS 版の src/time.ts に当たる
// 仕様は docs/spec/yaru-format.md の「時刻」
package clock

import "time"

// Now は環境変数 YARU_NOW があればその時刻に固定し、無ければ実行した瞬間を返す。読めない値は error
func Now() (time.Time, error) {
	panic("not implemented: clock.Now")
}

// ISOString は TS 版の Date.prototype.toISOString と同じ形 (UTC、ミリ秒 3 桁、末尾 Z) を返す
func ISOString(moment time.Time) string {
	panic("not implemented: clock.ISOString")
}

// RelativeTime は TS 版の relativeTime と同じ文字列を返す
func RelativeTime(moment time.Time, now time.Time) string {
	panic("not implemented: clock.RelativeTime")
}

// LocalDateTime は TS 版の localDateTime と同じ MM-DD HH:mm を、プロセスの時間帯 (TZ) で返す
func LocalDateTime(moment time.Time) string {
	panic("not implemented: clock.LocalDateTime")
}
