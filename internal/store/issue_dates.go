//declscope:namespace issue

package store

import (
	"strconv"
	"time"
)

// 終わった issue は期日を過ぎていても期限切れにしない。
// src/issue-dates.ts:9-18、docs/spec/yaru-format.md の「値の正規化」。
var finishedStatuses = map[string]struct{}{
	"done":     {},
	"canceled": {},
}

var dueMonthNames = []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

// IsIssueOverdue は開いている issue の期日が、今のローカル日付より前かを返す。
// src/issue-dates.ts:12-18
func IsIssueOverdue(dueDate *string, status string, now time.Time) bool {
	if dueDate == nil {
		return false
	}
	if _, finished := finishedStatuses[status]; finished {
		return false
	}
	return *dueDate < calendarDate(now)
}

// IsOverdue は状態を見ずに、期日がローカルの今日より前かを返す。
// src/store.ts:389-397
func IsOverdue(dueDate *string, now time.Time) bool {
	return dueDate != nil && *dueDate < calendarDate(now)
}

// FormatDueDate は期日を「Oct 20」のように出す。今年でなければ年を添える。
// 暦の日付を Date に通すと、UTC より西の地域で前日にずれるため、文字列のまま読む。
// src/issue-dates.ts:23-31
func FormatDueDate(dueDate string, now time.Time) string {
	year, month, day, ok := splitCalendarDate(dueDate)
	if !ok || month < 1 || month > 12 {
		return dueDate
	}
	short := dueMonthNames[month-1] + " " + strconv.Itoa(day)
	if year == now.In(time.Local).Year() {
		return short
	}
	return short + ", " + strconv.Itoa(year)
}

func calendarDate(now time.Time) string {
	local := now.In(time.Local)
	return padYear(local.Year()) + "-" + padTwo(int(local.Month())) + "-" + padTwo(local.Day())
}

// isCalendarDate は JS の new Date(年, 月 - 1, 日) と同じく、実在する暦日だけを受ける。
// 年 0 から 99 は 1900 年から 1999 年として読まれるので、書いた年と一致せず拒む。
// src/store.ts:455-462、docs/spec/yaru-format.md の「値の正規化」。
func isCalendarDate(value string) bool {
	year, month, day, ok := splitCalendarDate(value)
	if !ok {
		return false
	}
	constructedYear := year
	if year >= 0 && year <= 99 {
		constructedYear = 1900 + year
	}
	parsed := time.Date(constructedYear, time.Month(month), day, 0, 0, 0, 0, time.Local)
	return parsed.Year() == year && int(parsed.Month()) == month && parsed.Day() == day
}

func splitCalendarDate(value string) (int, int, int, bool) {
	if len(value) != 10 || value[4] != '-' || value[7] != '-' {
		return 0, 0, 0, false
	}
	for index := 0; index < len(value); index++ {
		if index == 4 || index == 7 {
			continue
		}
		if value[index] < '0' || value[index] > '9' {
			return 0, 0, 0, false
		}
	}
	year, _ := strconv.Atoi(value[0:4])
	month, _ := strconv.Atoi(value[5:7])
	day, _ := strconv.Atoi(value[8:10])
	return year, month, day, true
}

func padYear(value int) string {
	text := strconv.Itoa(value)
	for len(text) < 4 {
		text = "0" + text
	}
	return text
}

func padTwo(value int) string {
	text := strconv.Itoa(value)
	if len(text) < 2 {
		return "0" + text
	}
	return text
}
