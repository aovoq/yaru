//declscope:namespace clock

package clock

import (
	"testing"
	"time"
)

func TestParseJavaScriptTimeAcceptsISOAndDateOnly(t *testing.T) {
	parsed, ok := ParseJavaScriptTime("2026-09-25T09:00:00.000Z")
	if !ok || parsed.UTC().Format(time.RFC3339Nano) != "2026-09-25T09:00:00Z" {
		t.Fatalf("iso: %v %v", parsed, ok)
	}
	dateOnly, ok := ParseJavaScriptTime("2026-09-25")
	if !ok || dateOnly.UTC().Format("2006-01-02") != "2026-09-25" {
		t.Fatalf("date: %v %v", dateOnly, ok)
	}
	if _, ok := ParseJavaScriptTime("not-a-date"); ok {
		t.Fatal("accepted garbage")
	}
}

func TestParseYaruNowDoesNotReadTheEnvironment(t *testing.T) {
	t.Setenv("YARU_NOW", "yesterday")
	parsed, err := ParseYaruNow("2026-09-28T12:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if ISOString(parsed) != "2026-09-28T12:00:00.000Z" {
		t.Fatalf("parsed: %s", ISOString(parsed))
	}
}
