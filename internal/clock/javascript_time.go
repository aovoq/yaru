//declscope:namespace clock

// Date.parse に近い読み取り。質問の answerBy と、issue の updatedAt の解釈で使う。
// src/questions.ts の日時と src/issue-stale.ts:34 の Date.parse
package clock

import (
	"regexp"
	"strconv"
	"time"
)

// ParseJavaScriptTime は Date.parse が受け付ける、この実装が再現する形を時刻にする。
// 受け取れなければ ok は false。src/questions.ts の answerBy と、手で書いた日時。
func ParseJavaScriptTime(value string) (time.Time, bool) {
	if parsed, ok := parseAnswerByInput(value); ok {
		return parsed, true
	}
	if matches := dateOnlyPattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[1], matches[2], matches[3], "0", "0", "0", "", "Z", time.UTC)
	}
	if matches := localDateTimePattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[1], matches[2], matches[3], matches[4], matches[5], matches[6], matches[7], "Z", time.Local)
	}
	if matches := slashDatePattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[1], matches[2], matches[3], "0", "0", "0", "", "Z", time.Local)
	}
	if matches := monthFirstPattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[3], matches[1], matches[2], "0", "0", "0", "", "Z", time.Local)
	}
	if matches := spacedDateTimePattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[1], matches[2], matches[3], matches[4], matches[5], matches[6], matches[7], matches[8], time.UTC)
	}
	return time.Time{}, false
}

var answerByPattern = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$`)

func parseAnswerByInput(value string) (time.Time, bool) {
	matches := answerByPattern.FindStringSubmatch(value)
	if matches == nil {
		return time.Time{}, false
	}
	return componentsToTime(matches[1], matches[2], matches[3], matches[4], matches[5], matches[6], matches[7], matches[8], time.UTC)
}

var (
	dateOnlyPattern       = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)
	localDateTimePattern  = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$`)
	slashDatePattern      = regexp.MustCompile(`^(\d{4})/(\d{2})/(\d{2})$`)
	monthFirstPattern     = regexp.MustCompile(`^(\d{2})/(\d{2})/(\d{4})$`)
	spacedDateTimePattern = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$`)
)

func componentsToTime(yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone string, location *time.Location) (time.Time, bool) {
	year, yearErr := strconv.Atoi(yearText)
	month, monthErr := strconv.Atoi(monthText)
	day, dayErr := strconv.Atoi(dayText)
	hour, hourErr := strconv.Atoi(hourText)
	minute, minuteErr := strconv.Atoi(minuteText)
	second := 0
	if secondText != "" {
		parsed, err := strconv.Atoi(secondText)
		if err != nil {
			return time.Time{}, false
		}
		second = parsed
	}
	if yearErr != nil || monthErr != nil || dayErr != nil || hourErr != nil || minuteErr != nil {
		return time.Time{}, false
	}
	millisecond := fractionMilliseconds(fraction)
	if month < 1 || month > 12 || day < 1 || day > 31 || minute < 0 || minute > 59 || second < 0 || second > 59 {
		return time.Time{}, false
	}
	if hour == 24 {
		if minute != 0 || second != 0 || millisecond != 0 {
			return time.Time{}, false
		}
		hour = 0
		day++
	} else if hour < 0 || hour > 23 {
		return time.Time{}, false
	}
	moment := time.Date(year, time.Month(month), day, hour, minute, second, millisecond*1_000_000, location)
	if zone == "" || zone == "Z" {
		return moment, true
	}
	sign := 1
	if zone[0] == '-' {
		sign = -1
	}
	offsetHours, err := strconv.Atoi(zone[1:3])
	if err != nil {
		return time.Time{}, false
	}
	offsetMinutes, err := strconv.Atoi(zone[4:6])
	if err != nil {
		return time.Time{}, false
	}
	return moment.Add(-time.Duration(sign) * time.Duration(offsetHours*60+offsetMinutes) * time.Minute), true
}

func fractionMilliseconds(fraction string) int {
	if fraction == "" {
		return 0
	}
	if len(fraction) > 3 {
		fraction = fraction[:3]
	}
	for len(fraction) < 3 {
		fraction += "0"
	}
	parsed, err := strconv.Atoi(fraction)
	if err != nil {
		return 0
	}
	return parsed
}
