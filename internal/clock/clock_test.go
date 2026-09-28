// Now と ISOString を、src/time.ts の currentTime と Date.prototype.toISOString で確かめる
package clock_test

import (
	"os"
	"testing"
	"time"

	"github.com/aovoq/yaru/internal/clock"
)

const yaruNowErrorPrefix = "invalid YARU_NOW: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual "

func TestNowUsesTheClockWhenYaruNowIsUnset(t *testing.T) {
	original, existed := os.LookupEnv("YARU_NOW")
	t.Cleanup(func() {
		var restoreErr error
		if existed {
			restoreErr = os.Setenv("YARU_NOW", original)
		} else {
			restoreErr = os.Unsetenv("YARU_NOW")
		}
		if restoreErr != nil {
			t.Errorf("restore YARU_NOW: %v", restoreErr)
		}
	})
	if err := os.Unsetenv("YARU_NOW"); err != nil {
		t.Fatal(err)
	}
	before := time.Now()
	actual, err := clock.Now()
	after := time.Now()
	if err != nil {
		t.Fatal(err)
	}
	if actual.Before(before) || actual.After(after) {
		t.Fatalf("expected a time between %s and %s, actual %s", before.Format(time.RFC3339Nano), after.Format(time.RFC3339Nano), actual.Format(time.RFC3339Nano))
	}
}

func TestNowReadsYaruNow(t *testing.T) {
	// ミリ秒は bun の currentTime().getTime()。toISOString は src/time.test.ts と同じ形
	cases := []struct {
		value     string
		iso       string
		unixMilli int64
	}{
		{value: "2026-09-28T12:00:00.000Z", iso: "2026-09-28T12:00:00.000Z", unixMilli: 1790596800000},
		{value: "2026-09-28T12:00:00Z", iso: "2026-09-28T12:00:00.000Z", unixMilli: 1790596800000},
		{value: "2026-09-28T21:00:00+09:00", iso: "2026-09-28T12:00:00.000Z", unixMilli: 1790596800000},
		{value: "2026-09-28T12:00:00+09:00", iso: "2026-09-28T03:00:00.000Z", unixMilli: 1790564400000},
		{value: "2026-09-28T03:00:00-09:00", iso: "2026-09-28T12:00:00.000Z", unixMilli: 1790596800000},
		{value: "2026-09-28T12:00:00-09:30", iso: "2026-09-28T21:30:00.000Z", unixMilli: 1790631000000},
		{value: "2026-09-28T12:00:00+00:00", iso: "2026-09-28T12:00:00.000Z", unixMilli: 1790596800000},
		{value: "2026-09-28T12:00:00-00:00", iso: "2026-09-28T12:00:00.000Z", unixMilli: 1790596800000},
		{value: "2026-09-28T12:00:00+23:59", iso: "2026-09-27T12:01:00.000Z", unixMilli: 1790510460000},
		{value: "2026-09-28T12:00:00-23:59", iso: "2026-09-29T11:59:00.000Z", unixMilli: 1790683140000},
		{value: "2026-09-28T00:30:00-01:00", iso: "2026-09-28T01:30:00.000Z", unixMilli: 1790559000000},
		{value: "2026-09-28T00:00:00+14:00", iso: "2026-09-27T10:00:00.000Z", unixMilli: 1790503200000},
		{value: "2026-09-28T12:00:00.5Z", iso: "2026-09-28T12:00:00.500Z", unixMilli: 1790596800500},
		{value: "2026-09-28T12:00:00.50Z", iso: "2026-09-28T12:00:00.500Z", unixMilli: 1790596800500},
		{value: "2026-09-28T12:00:00.5006Z", iso: "2026-09-28T12:00:00.500Z", unixMilli: 1790596800500},
		{value: "2026-09-28T12:00:00.9999Z", iso: "2026-09-28T12:00:00.999Z", unixMilli: 1790596800999},
		{value: "2026-09-28T12:00:00.123456789Z", iso: "2026-09-28T12:00:00.123Z", unixMilli: 1790596800123},
		{value: "2026-09-28T12:00:00.0000001Z", iso: "2026-09-28T12:00:00.000Z", unixMilli: 1790596800000},
		{value: "2026-09-28T12:00:00.5+09:00", iso: "2026-09-28T03:00:00.500Z", unixMilli: 1790564400500},
		{value: "2024-02-29T12:00:00Z", iso: "2024-02-29T12:00:00.000Z", unixMilli: 1709208000000},
		{value: "2000-02-29T12:00:00Z", iso: "2000-02-29T12:00:00.000Z", unixMilli: 951825600000},
		{value: "0000-01-01T00:00:00Z", iso: "0000-01-01T00:00:00.000Z", unixMilli: -62167219200000},
		{value: "0000-02-29T00:00:00Z", iso: "0000-02-29T00:00:00.000Z", unixMilli: -62162121600000},
		{value: "0001-01-01T00:00:00Z", iso: "0001-01-01T00:00:00.000Z", unixMilli: -62135596800000},
		{value: "0099-12-31T23:59:59Z", iso: "0099-12-31T23:59:59.000Z", unixMilli: -59011459201000},
		{value: "0100-01-01T00:00:00Z", iso: "0100-01-01T00:00:00.000Z", unixMilli: -59011459200000},
		{value: "0400-02-29T00:00:00Z", iso: "0400-02-29T00:00:00.000Z", unixMilli: -49539340800000},
		{value: "1970-01-01T00:00:00.000Z", iso: "1970-01-01T00:00:00.000Z", unixMilli: 0},
		{value: "1969-12-31T23:59:59.999Z", iso: "1969-12-31T23:59:59.999Z", unixMilli: -1},
		{value: "9999-12-31T23:59:59.999Z", iso: "9999-12-31T23:59:59.999Z", unixMilli: 253402300799999},
	}
	for _, testCase := range cases {
		t.Run(testCase.value, func(t *testing.T) {
			t.Setenv("YARU_NOW", testCase.value)
			actual, err := clock.Now()
			if err != nil {
				t.Fatal(err)
			}
			if actual.UnixMilli() != testCase.unixMilli {
				t.Fatalf("expected unix milli %d, actual %d", testCase.unixMilli, actual.UnixMilli())
			}
			if clock.ISOString(actual) != testCase.iso {
				t.Fatalf("expected %s, actual %s", testCase.iso, clock.ISOString(actual))
			}
		})
	}
}

func TestNowRejectsYaruNow(t *testing.T) {
	cases := []struct {
		value      string
		actualJSON string
	}{
		{value: "", actualJSON: `""`},
		{value: "yesterday", actualJSON: `"yesterday"`},
		{value: "2026-09-28", actualJSON: `"2026-09-28"`},
		{value: "2026-02-30T12:00:00Z", actualJSON: `"2026-02-30T12:00:00Z"`},
		{value: "2026-02-29T12:00:00Z", actualJSON: `"2026-02-29T12:00:00Z"`},
		{value: "1900-02-29T12:00:00Z", actualJSON: `"1900-02-29T12:00:00Z"`},
		{value: "0100-02-29T00:00:00Z", actualJSON: `"0100-02-29T00:00:00Z"`},
		{value: "2026-13-01T12:00:00Z", actualJSON: `"2026-13-01T12:00:00Z"`},
		{value: "2026-00-01T12:00:00Z", actualJSON: `"2026-00-01T12:00:00Z"`},
		{value: "2026-09-31T12:00:00Z", actualJSON: `"2026-09-31T12:00:00Z"`},
		{value: "2026-04-31T00:00:00Z", actualJSON: `"2026-04-31T00:00:00Z"`},
		{value: "2026-09-28T24:00:00Z", actualJSON: `"2026-09-28T24:00:00Z"`},
		{value: "2026-09-28T23:59:60Z", actualJSON: `"2026-09-28T23:59:60Z"`},
		{value: "2026-09-28T12:60:00Z", actualJSON: `"2026-09-28T12:60:00Z"`},
		{value: "2026-09-28T12:00:00.Z", actualJSON: `"2026-09-28T12:00:00.Z"`},
		{value: "2026-09-28T12:00:00+24:00", actualJSON: `"2026-09-28T12:00:00+24:00"`},
		{value: "2026-09-28T12:00:00+09:60", actualJSON: `"2026-09-28T12:00:00+09:60"`},
		{value: "2026-09-28T12:00:00z", actualJSON: `"2026-09-28T12:00:00z"`},
		{value: "2026-09-28t12:00:00Z", actualJSON: `"2026-09-28t12:00:00Z"`},
		{value: "2026-09-28 12:00:00Z", actualJSON: `"2026-09-28 12:00:00Z"`},
		{value: " 2026-09-28T12:00:00Z", actualJSON: `" 2026-09-28T12:00:00Z"`},
		{value: "2026-09-28T12:00:00Z ", actualJSON: `"2026-09-28T12:00:00Z "`},
		{value: "say \"hi\"", actualJSON: `"say \"hi\""`},
		{value: "line\nbreak", actualJSON: `"line\nbreak"`},
		{value: "tab\there", actualJSON: `"tab\there"`},
		{value: "slash\\path", actualJSON: `"slash\\path"`},
		{value: "line\u2028sep", actualJSON: "\"line\u2028sep\""},
	}
	for _, testCase := range cases {
		t.Run(testCase.value, func(t *testing.T) {
			t.Setenv("YARU_NOW", testCase.value)
			_, err := clock.Now()
			if err == nil {
				t.Fatal("expected an error")
			}
			expected := yaruNowErrorPrefix + testCase.actualJSON
			if err.Error() != expected {
				t.Fatalf("expected %s, actual %s", expected, err.Error())
			}
		})
	}
}

func TestISOStringMatchesToISOString(t *testing.T) {
	tokyo := time.FixedZone("Asia/Tokyo", 9*60*60)
	cases := []struct {
		name     string
		moment   time.Time
		expected string
	}{
		{name: "utc", moment: time.UnixMilli(1790596800000), expected: "2026-09-28T12:00:00.000Z"},
		{name: "tokyo wall clock", moment: time.Date(2026, 9, 28, 21, 0, 0, 0, tokyo), expected: "2026-09-28T12:00:00.000Z"},
		{name: "milliseconds", moment: time.UnixMilli(1790596800500), expected: "2026-09-28T12:00:00.500Z"},
		{name: "sub millisecond is dropped", moment: time.Date(2026, 9, 28, 12, 0, 0, 500_600_000, time.UTC), expected: "2026-09-28T12:00:00.500Z"},
		{name: "year 0", moment: time.UnixMilli(-62167219200000), expected: "0000-01-01T00:00:00.000Z"},
		{name: "year 100", moment: time.UnixMilli(-59011459200000), expected: "0100-01-01T00:00:00.000Z"},
		{name: "epoch", moment: time.UnixMilli(0), expected: "1970-01-01T00:00:00.000Z"},
		{name: "before the epoch", moment: time.UnixMilli(-1), expected: "1969-12-31T23:59:59.999Z"},
		{name: "year 9999", moment: time.UnixMilli(253402300799999), expected: "9999-12-31T23:59:59.999Z"},
		{name: "expanded year", moment: time.UnixMilli(253402300800000), expected: "+010000-01-01T00:00:00.000Z"},
		{name: "negative year", moment: time.UnixMilli(-62198755200000), expected: "-000001-01-01T00:00:00.000Z"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			actual := clock.ISOString(testCase.moment)
			if actual != testCase.expected {
				t.Fatalf("expected %s, actual %s", testCase.expected, actual)
			}
		})
	}
}
