//declscope:core

package server

import (
	"io"
	"os"
	"os/exec"
	"strings"
	"unicode/utf8"
)

// tailscaleStatusLimit は status --json の読み取り上限。超えた出力は読めなかったものとして公開 host を無しにする。
const tailscaleStatusLimit = 32 << 20

// detectTailscaleDNSName は tailscale status --json の Self.DNSName を読む。
// 実行ファイルは YARU_TAILSCALE_BIN、無ければ PATH の tailscale。引数は status と --json だけ。
// 失敗しても起動は失敗させない。docs/spec/security.md の「許可する Host」
func detectTailscaleDNSName() (string, bool) {
	binaryPath := "tailscale"
	if configured, exists := os.LookupEnv("YARU_TAILSCALE_BIN"); exists {
		binaryPath = configured
	}
	command := exec.Command(binaryPath, "status", "--json")
	command.Stderr = io.Discard
	stdout, err := command.StdoutPipe()
	if err != nil {
		return "", false
	}
	if err := command.Start(); err != nil {
		return "", false
	}
	output, readErr := io.ReadAll(io.LimitReader(stdout, tailscaleStatusLimit+1))
	if len(output) > tailscaleStatusLimit {
		if command.Process != nil {
			_ = command.Process.Kill()
		}
		_ = command.Wait()
		return "", false
	}
	waitErr := command.Wait()
	if readErr != nil || waitErr != nil {
		return "", false
	}
	name, ok := selfDNSName(output)
	if !ok || name == "" {
		return "", false
	}
	return name, true
}

// selfDNSName は最上位の Self.DNSName だけを返す。他のオブジェクトの DNSName は見ない。
// yaru のファイルではないので document.MarshalJavaScript の対にはせず、必要なフィールドだけ読む。
func selfDNSName(data []byte) (string, bool) {
	cursor := &jsonCursor{data: data}
	cursor.skipSpace()
	if !cursor.consume('{') {
		return "", false
	}
	for {
		cursor.skipSpace()
		if cursor.consume('}') {
			return "", false
		}
		key, ok := cursor.parseString()
		if !ok {
			return "", false
		}
		cursor.skipSpace()
		if !cursor.consume(':') {
			return "", false
		}
		cursor.skipSpace()
		if key == "Self" {
			return cursor.dnsNameInObject()
		}
		if !cursor.skipValue() {
			return "", false
		}
		cursor.skipSpace()
		if cursor.consume('}') {
			return "", false
		}
		if !cursor.consume(',') {
			return "", false
		}
	}
}

func (cursor *jsonCursor) dnsNameInObject() (string, bool) {
	if !cursor.consume('{') {
		return "", false
	}
	var found string
	var present bool
	for {
		cursor.skipSpace()
		if cursor.consume('}') {
			return found, present && found != ""
		}
		key, ok := cursor.parseString()
		if !ok {
			return "", false
		}
		cursor.skipSpace()
		if !cursor.consume(':') {
			return "", false
		}
		cursor.skipSpace()
		if key == "DNSName" {
			value, parsed := cursor.parseString()
			if !parsed {
				return "", false
			}
			found = value
			present = true
		} else if !cursor.skipValue() {
			return "", false
		}
		cursor.skipSpace()
		if cursor.consume('}') {
			return found, present && found != ""
		}
		if !cursor.consume(',') {
			return "", false
		}
	}
}

type jsonCursor struct {
	data  []byte
	index int
}

func (cursor *jsonCursor) skipSpace() {
	for cursor.index < len(cursor.data) {
		switch cursor.data[cursor.index] {
		case ' ', '\n', '\r', '\t':
			cursor.index++
		default:
			return
		}
	}
}

func (cursor *jsonCursor) consume(character byte) bool {
	if cursor.index < len(cursor.data) && cursor.data[cursor.index] == character {
		cursor.index++
		return true
	}
	return false
}

func (cursor *jsonCursor) skipValue() bool {
	if cursor.index >= len(cursor.data) {
		return false
	}
	switch cursor.data[cursor.index] {
	case '{':
		return cursor.skipObject()
	case '[':
		return cursor.skipArray()
	case '"':
		_, ok := cursor.parseString()
		return ok
	case 't':
		return cursor.consumeLiteral("true")
	case 'f':
		return cursor.consumeLiteral("false")
	case 'n':
		return cursor.consumeLiteral("null")
	default:
		return cursor.skipNumber()
	}
}

func (cursor *jsonCursor) skipObject() bool {
	if !cursor.consume('{') {
		return false
	}
	cursor.skipSpace()
	if cursor.consume('}') {
		return true
	}
	for {
		if _, ok := cursor.parseString(); !ok {
			return false
		}
		cursor.skipSpace()
		if !cursor.consume(':') {
			return false
		}
		cursor.skipSpace()
		if !cursor.skipValue() {
			return false
		}
		cursor.skipSpace()
		if cursor.consume('}') {
			return true
		}
		if !cursor.consume(',') {
			return false
		}
		cursor.skipSpace()
	}
}

func (cursor *jsonCursor) skipArray() bool {
	if !cursor.consume('[') {
		return false
	}
	cursor.skipSpace()
	if cursor.consume(']') {
		return true
	}
	for {
		if !cursor.skipValue() {
			return false
		}
		cursor.skipSpace()
		if cursor.consume(']') {
			return true
		}
		if !cursor.consume(',') {
			return false
		}
		cursor.skipSpace()
	}
}

func (cursor *jsonCursor) consumeLiteral(literal string) bool {
	if cursor.index+len(literal) > len(cursor.data) {
		return false
	}
	if string(cursor.data[cursor.index:cursor.index+len(literal)]) != literal {
		return false
	}
	cursor.index += len(literal)
	return true
}

func (cursor *jsonCursor) skipNumber() bool {
	start := cursor.index
	for cursor.index < len(cursor.data) {
		character := cursor.data[cursor.index]
		if (character >= '0' && character <= '9') || character == '.' || character == 'e' || character == 'E' || character == '+' || character == '-' {
			cursor.index++
			continue
		}
		break
	}
	return cursor.index > start
}

func (cursor *jsonCursor) parseString() (string, bool) {
	if !cursor.consume('"') {
		return "", false
	}
	var builder strings.Builder
	for cursor.index < len(cursor.data) {
		character := cursor.data[cursor.index]
		cursor.index++
		if character == '"' {
			return builder.String(), true
		}
		if character != '\\' {
			builder.WriteByte(character)
			continue
		}
		if cursor.index >= len(cursor.data) {
			return "", false
		}
		escaped := cursor.data[cursor.index]
		cursor.index++
		switch escaped {
		case '"', '\\', '/':
			builder.WriteByte(escaped)
		case 'b':
			builder.WriteByte('\b')
		case 'f':
			builder.WriteByte('\f')
		case 'n':
			builder.WriteByte('\n')
		case 'r':
			builder.WriteByte('\r')
		case 't':
			builder.WriteByte('\t')
		case 'u':
			runeValue, ok := cursor.parseHexRune()
			if !ok {
				return "", false
			}
			builder.WriteRune(runeValue)
		default:
			return "", false
		}
	}
	return "", false
}

func (cursor *jsonCursor) parseHexRune() (rune, bool) {
	if cursor.index+4 > len(cursor.data) {
		return 0, false
	}
	var value rune
	for offset := 0; offset < 4; offset++ {
		digit := cursor.data[cursor.index+offset]
		value <<= 4
		switch {
		case digit >= '0' && digit <= '9':
			value += rune(digit - '0')
		case digit >= 'a' && digit <= 'f':
			value += rune(digit-'a') + 10
		case digit >= 'A' && digit <= 'F':
			value += rune(digit-'A') + 10
		default:
			return 0, false
		}
	}
	cursor.index += 4
	if !utf8.ValidRune(value) {
		return utf8.RuneError, true
	}
	return value, true
}
