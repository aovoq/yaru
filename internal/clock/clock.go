// CLI とサーバーの「今」と、時刻の書き方。TS 版の src/time.ts に当たる
// 仕様は docs/spec/yaru-format.md の「時刻」
package clock

import (
	"fmt"
	"os"
	"regexp"
	"time"

	"github.com/aovoq/yaru/internal/document"
)

// yaruNowPattern は src/time.ts:5 の ISO_8601_DATETIME。秒は必須で、日付だけは受けない
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
var yaruNowPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`)

// Now は環境変数 YARU_NOW があればその時刻に固定し、無ければ実行した瞬間を返す。読めない値は error
// 空文字は未設定と区別し、検査に落ちる (src/time.ts:43-45, docs/spec/yaru-format.md の「時刻」)
func Now() (time.Time, error) {
	value, exists := os.LookupEnv("YARU_NOW")
	if !exists {
		return time.Now(), nil
	}
	return parseYaruNow(value)
}

// ISOString は TS 版の Date.prototype.toISOString と同じ形 (UTC、ミリ秒 3 桁、末尾 Z) を返す
// 0 から 9999 年は 4 桁。範囲の外は拡張年で、10000 年は +010000、紀元前 1 年は -000001
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
// https://tc39.es/ecma262/#sec-expanded-years
func ISOString(moment time.Time) string {
	utc := moment.UTC()
	// 小数は先頭 3 桁だけを出す。Date はミリ秒までしか持たないので、残りのナノ秒は四捨五入しない
	monthDayTime := utc.Format("01-02T15:04:05.000Z")
	year := utc.Year()
	if year >= 0 && year <= 9999 {
		return fmt.Sprintf("%04d-%s", year, monthDayTime)
	}
	sign := "+"
	absoluteYear := year
	if year < 0 {
		sign = "-"
		absoluteYear = -year
	}
	return fmt.Sprintf("%s%06d-%s", sign, absoluteYear, monthDayTime)
}

// RelativeTime は TS 版の relativeTime と同じ文字列を返す
// 30 秒未満は now。48 時間未満は時間、それ以上は日で、最短の日は 2d (src/time.ts:49-63)
func RelativeTime(moment time.Time, now time.Time) string {
	differenceMilliseconds := moment.UnixMilli() - now.UnixMilli()
	absoluteMilliseconds := differenceMilliseconds
	if absoluteMilliseconds < 0 {
		absoluteMilliseconds = -absoluteMilliseconds
	}
	// Math.round。30 秒 (0.5 分) は 1 分に切り上げる (src/time.ts:53)
	roundedMinutes := (absoluteMilliseconds + 30_000) / 60_000
	if roundedMinutes < 1 {
		return "now"
	}
	span := relativeSpan(roundedMinutes)
	if differenceMilliseconds >= 0 {
		return "in " + span
	}
	return span + " ago"
}

func relativeSpan(roundedMinutes int64) string {
	if roundedMinutes < 60 {
		return fmt.Sprintf("%dm", roundedMinutes)
	}
	// 48 時間ちょうどは日になる。24 時間は 1d ではなく 24h (src/time.ts:59-61)
	if roundedMinutes < 60*48 {
		hours := roundedMinutes / 60
		remainderMinutes := roundedMinutes % 60
		if remainderMinutes == 0 {
			return fmt.Sprintf("%dh", hours)
		}
		return fmt.Sprintf("%dh %dm", hours, remainderMinutes)
	}
	return fmt.Sprintf("%dd", roundedMinutes/(60*24))
}

// LocalDateTime は TS 版の localDateTime と同じ MM-DD HH:mm を、プロセスの時間帯 (TZ) で返す
// 秒は分に繰り上げない。getMinutes と同じ (src/time.ts:67-73)
func LocalDateTime(moment time.Time) string {
	return moment.In(time.Local).Format("01-02 15:04")
}

// parseYaruNow は YARU_NOW を src/time.ts:7-41 と同じ瞬間にする
// 存在しない日は time.Date が翌月へ繰り上げるので、読み直した年月日時分秒が入力と違うときは拒む (src/time.ts:23-32)
func parseYaruNow(value string) (time.Time, error) {
	if !yaruNowPattern.MatchString(value) {
		return time.Time{}, invalidYaruNow(value)
	}
	year := decimal(value[0:4])
	month := decimal(value[5:7])
	day := decimal(value[8:10])
	hour := decimal(value[11:13])
	minute := decimal(value[14:16])
	second := decimal(value[17:19])
	fractionDigits, zoneText := splitFraction(value[19:])
	// Date.parse は .5006 を 500 ミリ秒、.9995 を 999 ミリ秒にする。4 桁目以降は切り捨てる
	milliseconds := millisecondsFromFraction(fractionDigits)
	// Date.parse は時差の時が 24 以上、または分が 60 以上のとき NaN になる。FixedZone はその値でも壁時計を保ててしまう
	offsetSeconds, offsetOK := offsetSecondsFromZone(zoneText)
	if !offsetOK {
		return time.Time{}, invalidYaruNow(value)
	}
	location := time.FixedZone("YARU_NOW", offsetSeconds)
	parsed := time.Date(year, time.Month(month), day, hour, minute, second, milliseconds*1_000_000, location)
	if parsed.Year() != year || int(parsed.Month()) != month || parsed.Day() != day || parsed.Hour() != hour || parsed.Minute() != minute || parsed.Second() != second {
		return time.Time{}, invalidYaruNow(value)
	}
	return parsed.UTC(), nil
}

func splitFraction(remainder string) (string, string) {
	if len(remainder) == 0 || remainder[0] != '.' {
		return "", remainder
	}
	remainder = remainder[1:]
	digitCount := 0
	for digitCount < len(remainder) && remainder[digitCount] >= '0' && remainder[digitCount] <= '9' {
		digitCount++
	}
	return remainder[:digitCount], remainder[digitCount:]
}

func millisecondsFromFraction(digits string) int {
	milliseconds := 0
	for index := 0; index < 3; index++ {
		milliseconds *= 10
		if index < len(digits) {
			milliseconds += int(digits[index] - '0')
		}
	}
	return milliseconds
}

func offsetSecondsFromZone(zoneText string) (int, bool) {
	if zoneText == "Z" {
		return 0, true
	}
	if len(zoneText) != 6 || (zoneText[0] != '+' && zoneText[0] != '-') {
		return 0, false
	}
	offsetHour := decimal(zoneText[1:3])
	offsetMinute := decimal(zoneText[4:6])
	if offsetHour > 23 || offsetMinute > 59 {
		return 0, false
	}
	sign := 1
	if zoneText[0] == '-' {
		sign = -1
	}
	return sign * (offsetHour*60 + offsetMinute) * 60, true
}

func decimal(digits string) int {
	number := 0
	for _, digit := range digits {
		number = number*10 + int(digit-'0')
	}
	return number
}

func invalidYaruNow(value string) error {
	quoted, err := document.MarshalJavaScript(value)
	if err != nil {
		return err
	}
	return fmt.Errorf("invalid YARU_NOW: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual %s", quoted)
}
