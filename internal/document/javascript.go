//declscope:namespace document

// JavaScript の文字列と数値。trim、Number、Number#toString、JSON.stringify の数値と文字列。
// 写しはここに 1 つだけ置く。src/store.ts:467、src/index.ts の Number、docs/spec/yaru-format.md の「JSON の escape」
package document

import (
	"math"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Trim は String.prototype.trim と同じ文字を両端から外す。U+0085 は外さない。
func Trim(value string) string {
	start := 0
	end := len(value)
	for start < end {
		character, size := utf8.DecodeRuneInString(value[start:])
		if !IsJavaScriptWhitespace(character) {
			break
		}
		start += size
	}
	for end > start {
		character, size := utf8.DecodeLastRuneInString(value[:end])
		if !IsJavaScriptWhitespace(character) {
			break
		}
		end -= size
	}
	return value[start:end]
}

// IsJavaScriptWhitespace は trim が外す 1 文字。空白の Unicode カテゴリ Zs を含む。
func IsJavaScriptWhitespace(character rune) bool {
	switch character {
	case '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\ufeff', '\u2028', '\u2029':
		return true
	default:
		return unicode.Is(unicode.Zs, character)
	}
}

// ParseNumber は JS の Number。空文字は 0。0x 0b 0o と Infinity を受ける。
// src/index.ts の port と、id の数値化で使う。
func ParseNumber(value string) (float64, bool) {
	trimmed := Trim(value)
	if trimmed == "" {
		return 0, true
	}
	switch trimmed {
	case "Infinity", "+Infinity":
		return math.Inf(1), true
	case "-Infinity":
		return math.Inf(-1), true
	case "NaN":
		return math.NaN(), true
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "0x") || strings.HasPrefix(lower, "0b") || strings.HasPrefix(lower, "0o") {
		return parsePrefixedInteger(lower)
	}
	number, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, false
	}
	return number, true
}

func parsePrefixedInteger(lower string) (float64, bool) {
	base := 16
	body := lower[2:]
	switch lower[:2] {
	case "0b":
		base = 2
	case "0o":
		base = 8
	}
	if body == "" {
		return 0, false
	}
	number, err := strconv.ParseUint(body, base, 64)
	if err != nil {
		return 0, false
	}
	return float64(number), true
}

// FormatNumber は Number.prototype.toString。有限の値は JSON.stringify の数値と同じ並び。
// NaN と Infinity は文字列のまま。-0 は 0。
func FormatNumber(number float64) string {
	if math.IsNaN(number) {
		return "NaN"
	}
	if math.IsInf(number, 1) {
		return "Infinity"
	}
	if math.IsInf(number, -1) {
		return "-Infinity"
	}
	return formatFiniteNumber(number)
}

// FormatJSONNumber は JSON.stringify の数値。NaN と Infinity は null。
// src/workspaces.ts:37
func FormatJSONNumber(number float64) string {
	if math.IsNaN(number) || math.IsInf(number, 0) {
		return "null"
	}
	return formatFiniteNumber(number)
}

func formatFiniteNumber(number float64) string {
	if number == 0 {
		return "0"
	}
	sign := ""
	if number < 0 {
		sign = "-"
		number = -number
	}
	scientific := strconv.FormatFloat(number, 'e', -1, 64)
	mantissa, exponentText, _ := strings.Cut(scientific, "e")
	exponent, _ := strconv.Atoi(exponentText)
	digits := strings.ReplaceAll(mantissa, ".", "")
	digitCount := len(digits)
	coefficientDigits := exponent + 1
	if digitCount <= coefficientDigits && coefficientDigits <= 21 {
		return sign + digits + strings.Repeat("0", coefficientDigits-digitCount)
	}
	if 0 < coefficientDigits && coefficientDigits <= 21 {
		return sign + digits[:coefficientDigits] + "." + digits[coefficientDigits:]
	}
	if -6 < coefficientDigits && coefficientDigits <= 0 {
		return sign + "0." + strings.Repeat("0", -coefficientDigits) + digits
	}
	exponentOut := coefficientDigits - 1
	if digitCount == 1 {
		return sign + digits + "e" + formatExponent(exponentOut)
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + formatExponent(exponentOut)
}

func formatExponent(exponent int) string {
	if exponent >= 0 {
		return "+" + strconv.Itoa(exponent)
	}
	return strconv.Itoa(exponent)
}

// Quote は JSON.stringify が文字列に付ける引用符。中の escape も含む。
func Quote(value string) (string, error) {
	encoded, err := MarshalJavaScript(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
