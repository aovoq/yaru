//declscope:namespace document

package document

import (
	"math"
	"testing"
)

func TestTrimRemovesJavaScriptWhitespace(t *testing.T) {
	if got := Trim(" \t\n\v\f\r\u00a0\u2028\u2029\ufeffa \u3000"); got != "a" {
		t.Fatalf("trim: %q", got)
	}
	if Trim("") != "" || Trim("a") != "a" {
		t.Fatal("identity")
	}
	if IsJavaScriptWhitespace('字') {
		t.Fatal("letter is not whitespace")
	}
}

func TestParseNumberMatchesJavaScriptNumber(t *testing.T) {
	cases := []struct {
		text  string
		value float64
		ok    bool
	}{
		{text: "", value: 0, ok: true},
		{text: " \t12 ", value: 12, ok: true},
		{text: "Infinity", value: math.Inf(1), ok: true},
		{text: "+Infinity", value: math.Inf(1), ok: true},
		{text: "-Infinity", value: math.Inf(-1), ok: true},
		{text: "0x10", value: 16, ok: true},
		{text: "0b11", value: 3, ok: true},
		{text: "0o10", value: 8, ok: true},
		{text: "1e2", value: 100, ok: true},
		{text: "nope", ok: false},
	}
	for _, testCase := range cases {
		value, ok := ParseNumber(testCase.text)
		if ok != testCase.ok || (ok && value != testCase.value) {
			t.Fatalf("%q: got %v %v", testCase.text, value, ok)
		}
	}
}

func TestFormatNumberMatchesNumberToString(t *testing.T) {
	if FormatNumber(0) != "0" || FormatNumber(12) != "12" || FormatNumber(1.5) != "1.5" {
		t.Fatal("decimals")
	}
	if FormatNumber(math.Inf(1)) != "Infinity" || FormatNumber(math.Inf(-1)) != "-Infinity" {
		t.Fatal("infinity")
	}
	if FormatNumber(math.NaN()) != "NaN" {
		t.Fatal("nan")
	}
}

func TestQuoteMatchesJSONStringify(t *testing.T) {
	quoted, err := Quote("a\"b\\c")
	if err != nil {
		t.Fatal(err)
	}
	if quoted != `"a\"b\\c"` {
		t.Fatalf("quote: %s", quoted)
	}
}
