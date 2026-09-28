//declscope:namespace cli

// 引数の読み方。TS 版の src/index.ts:815-845 の parse と、その前後の検査
package cli

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/aovoq/yaru/internal/server"
	"github.com/aovoq/yaru/internal/store"
)

// bareFlags は値を取らないフラグ。src/index.ts:815
var bareFlags = map[string]struct{}{
	"help": {}, "h": {}, "format": {}, "f": {}, "force": {},
}

var limitPattern = regexp.MustCompile(`^[0-9]+$`)
var durationPattern = regexp.MustCompile(`^(\d+)(ms|s|m|h)$`)

type parsedArguments struct {
	rest   []string
	values map[string][]string
	order  []string
}

// parseArguments は src/index.ts:817-845。`--` より後ろは位置引数。`-hf` のような束はフラグにしない
func parseArguments(argv []string) (parsedArguments, error) {
	parsed := parsedArguments{values: map[string][]string{}}
	for index := 0; index < len(argv); index++ {
		argument := argv[index]
		if argument == "--" {
			parsed.rest = append(parsed.rest, argv[index+1:]...)
			break
		}
		if strings.HasPrefix(argument, "--") || singleLetterFlag(argument) {
			key := flagKey(argument)
			if _, bare := bareFlags[key]; bare {
				appendFlag(&parsed, key, "true")
				continue
			}
			if index+1 >= len(argv) || strings.HasPrefix(argv[index+1], "--") || singleLetterFlag(argv[index+1]) {
				return parsedArguments{}, fmt.Errorf("missing value for %s", argument)
			}
			appendFlag(&parsed, key, argv[index+1])
			index++
			continue
		}
		parsed.rest = append(parsed.rest, argument)
	}
	return parsed, nil
}

func appendFlag(parsed *parsedArguments, key string, value string) {
	if _, exists := parsed.values[key]; !exists {
		parsed.order = append(parsed.order, key)
	}
	parsed.values[key] = append(parsed.values[key], value)
}

// flagKey は src/index.ts:827 の replace(/^--?/, "")。`--` か `-` を先頭から 1 回だけ外す
func flagKey(argument string) string {
	if strings.HasPrefix(argument, "--") {
		return argument[2:]
	}
	return argument[1:]
}

func singleLetterFlag(argument string) bool {
	if len(argument) != 2 || argument[0] != '-' {
		return false
	}
	letter := argument[1]
	return (letter >= 'a' && letter <= 'z') || (letter >= 'A' && letter <= 'Z')
}

func (parsed parsedArguments) flag(key string) (string, bool) {
	values := parsed.values[key]
	if len(values) == 0 {
		return "", false
	}
	return values[0], true
}

func truthyFlag(parsed parsedArguments, key string) bool {
	value, present := parsed.flag(key)
	return present && value != ""
}

// wantsHelp は src/index.ts:335。値の欠けは parse の時点で先に落ちるので、--help はそれを覆さない
func wantsHelp(parsed parsedArguments) bool {
	if truthyFlag(parsed, "help") || truthyFlag(parsed, "h") {
		return true
	}
	return len(parsed.rest) > 0 && parsed.rest[0] == "help"
}

func rejectUnknownFlag(parsed parsedArguments, allowed map[string]struct{}) error {
	for _, key := range parsed.order {
		if _, allowedKey := allowed[key]; allowedKey {
			continue
		}
		// src/index.ts:807。キーが 1 文字なら、--x と渡しても -x と書く
		if len(key) == 1 {
			return fmt.Errorf("unknown flag: -%s", key)
		}
		return fmt.Errorf("unknown flag: --%s", key)
	}
	return nil
}

func rejectExtra(rest []string) error {
	if len(rest) > 0 {
		return fmt.Errorf("unexpected argument: %s", rest[0])
	}
	return nil
}

// positionalIdentifier は `flag("id") || rest[1]`。空文字は JS では偽なので位置引数へ落ちる (src/index.ts:456)
// 返す rest は、id に使った分を除いた残り。--id が空のときは位置引数を id にし、その分も消費する
func positionalIdentifier(parsed parsedArguments, rest []string) (string, []string) {
	if value, present := parsed.flag("id"); present && value != "" {
		return value, rest[1:]
	}
	if len(rest) < 2 {
		return "", nil
	}
	return rest[1], rest[2:]
}

// parseLimit は src/index.ts:781-786。数字以外はここで拒む。
// 範囲と Infinity の文言は store.PageIssues が Number と同じ値で出す。
func parseLimit(raw string, present bool) (any, error) {
	if !present {
		return nil, nil
	}
	if !limitPattern.MatchString(raw) {
		return nil, fmt.Errorf("invalid limit: expected an integer from 1 to %d, actual %s", store.ListLimitMax, raw)
	}
	number, err := strconv.ParseFloat(raw, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return nil, fmt.Errorf("invalid limit: expected an integer from 1 to %d, actual %s", store.ListLimitMax, raw)
	}
	if math.IsInf(number, 0) || errors.Is(err, strconv.ErrRange) {
		return math.Inf(1), nil
	}
	if number == math.Trunc(number) && number >= math.MinInt && number <= math.MaxInt {
		return int(number), nil
	}
	return number, nil
}

// parseDuration は src/index.ts:721-728。0 も受け、単位は ms s m h だけ
func parseDuration(name string, raw string) (int64, error) {
	match := durationPattern.FindStringSubmatch(raw)
	if match == nil {
		return 0, fmt.Errorf("invalid %s: expected a duration like 100ms, 30s, 10m, or 1h, actual %s", name, raw)
	}
	count, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: expected a duration like 100ms, 30s, 10m, or 1h, actual %s", name, raw)
	}
	unitMilliseconds := map[string]int64{"ms": 1, "s": 1000, "m": 60_000, "h": 3_600_000}[match[2]]
	if count > 0 && unitMilliseconds > math.MaxInt64/count {
		return math.MaxInt64, nil
	}
	return count * unitMilliseconds, nil
}

// parsePort は src/index.ts:797-801。Number と Number.isInteger に合わせ、文言には渡された文字列を出す
// 空文字と未指定は既定の port。呼び出し側が `flag("port") || flag("p")` の偽を落としてから渡す
func parsePort(raw string, present bool) (int, error) {
	if !present {
		return server.DefaultPort, nil
	}
	number, parsed := javaScriptNumber(raw)
	if !parsed || math.IsNaN(number) || math.IsInf(number, 0) || number != math.Trunc(number) || number < 1 || number > 65535 {
		return 0, fmt.Errorf("invalid port: %s", raw)
	}
	return int(number), nil
}

func chosenPort(parsed parsedArguments) (int, error) {
	if truthyFlag(parsed, "port") {
		value, _ := parsed.flag("port")
		return parsePort(value, true)
	}
	if truthyFlag(parsed, "p") {
		value, _ := parsed.flag("p")
		return parsePort(value, true)
	}
	return server.DefaultPort, nil
}

// javaScriptNumber は JS の Number。空白を削り、0x 0b 0o と指数を受ける
func javaScriptNumber(raw string) (float64, bool) {
	trimmed := strings.TrimFunc(raw, isJavaScriptWhitespace)
	if trimmed == "" {
		return 0, true
	}
	switch trimmed {
	case "Infinity", "+Infinity":
		return math.Inf(1), true
	case "-Infinity":
		return math.Inf(-1), true
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "0x") || strings.HasPrefix(lower, "0b") || strings.HasPrefix(lower, "0o") {
		return prefixedInteger(lower)
	}
	number, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, false
	}
	return number, true
}

func prefixedInteger(lower string) (float64, bool) {
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

func isJavaScriptWhitespace(character rune) bool {
	switch character {
	case '\u0009', '\u000B', '\u000C', '\u0020', '\u00A0', '\uFEFF', '\n', '\r', '\u2028', '\u2029':
		return true
	default:
		return unicode.Is(unicode.Zs, character)
	}
}

func definedString(parsed parsedArguments, key string) (*string, bool) {
	value, present := parsed.flag(key)
	if !present {
		return nil, false
	}
	return &value, true
}

func flagSet(allowed ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		set[key] = struct{}{}
	}
	return set
}
