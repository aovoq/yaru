//declscope:core

package workspace

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/aovoq/yaru/internal/document"
)

// Node の readFileSync(path, "utf8") と同じく、壊れた UTF-8 は U+FFFD にする
// docs/spec/yaru-format.md の未決 13
func decodeUTF8(data []byte) string {
	if utf8.Valid(data) {
		return string(data)
	}
	var builder strings.Builder
	for len(data) > 0 {
		character, size := utf8.DecodeRune(data)
		builder.WriteRune(character)
		data = data[size:]
	}
	return builder.String()
}

const (
	jsonNull = iota
	jsonBool
	jsonNumber
	jsonString
	jsonArray
	jsonObject
)

// jsonValue は JSON.parse の値。オブジェクトのキー順は最初に出た順で、同じキーは値だけ置き換える
type jsonValue struct {
	kind     int
	text     string
	boolean  bool
	elements []jsonValue
	fields   []jsonField
}

type jsonField struct {
	key   string
	value jsonValue
}

func parseJSON(text string) (jsonValue, error) {
	parser := jsonParser{text: text}
	parser.skipSpace()
	value, err := parser.parseValue()
	if err != nil {
		return jsonValue{}, err
	}
	parser.skipSpace()
	if parser.index != len(parser.text) {
		return jsonValue{}, fmt.Errorf("invalid json: trailing data at byte %d", parser.index)
	}
	return value, nil
}

type jsonParser struct {
	text  string
	index int
}

func (parser *jsonParser) skipSpace() {
	for parser.index < len(parser.text) {
		switch parser.text[parser.index] {
		case ' ', '\t', '\n', '\r':
			parser.index++
		default:
			return
		}
	}
}

func (parser *jsonParser) parseValue() (jsonValue, error) {
	parser.skipSpace()
	if parser.index >= len(parser.text) {
		return jsonValue{}, fmt.Errorf("invalid json: unexpected end")
	}
	switch parser.text[parser.index] {
	case 'n':
		return parser.parseLiteral("null", jsonValue{kind: jsonNull})
	case 't':
		return parser.parseLiteral("true", jsonValue{kind: jsonBool, boolean: true})
	case 'f':
		return parser.parseLiteral("false", jsonValue{kind: jsonBool, boolean: false})
	case '"':
		text, err := parser.parseString()
		if err != nil {
			return jsonValue{}, err
		}
		return jsonValue{kind: jsonString, text: text}, nil
	case '{':
		return parser.parseObject()
	case '[':
		return parser.parseArray()
	default:
		return parser.parseNumber()
	}
}

func (parser *jsonParser) parseLiteral(literal string, value jsonValue) (jsonValue, error) {
	if parser.index+len(literal) > len(parser.text) || parser.text[parser.index:parser.index+len(literal)] != literal {
		return jsonValue{}, fmt.Errorf("invalid json: expected %s at byte %d", literal, parser.index)
	}
	parser.index += len(literal)
	return value, nil
}

func (parser *jsonParser) parseObject() (jsonValue, error) {
	parser.index++
	var fields []jsonField
	parser.skipSpace()
	if parser.consume('}') {
		return jsonValue{kind: jsonObject, fields: fields}, nil
	}
	for {
		parser.skipSpace()
		if parser.index >= len(parser.text) || parser.text[parser.index] != '"' {
			return jsonValue{}, fmt.Errorf("invalid json: expected object key at byte %d", parser.index)
		}
		key, err := parser.parseString()
		if err != nil {
			return jsonValue{}, err
		}
		parser.skipSpace()
		if !parser.consume(':') {
			return jsonValue{}, fmt.Errorf("invalid json: expected colon at byte %d", parser.index)
		}
		value, err := parser.parseValue()
		if err != nil {
			return jsonValue{}, err
		}
		replaced := false
		for index := range fields {
			if fields[index].key == key {
				fields[index].value = value
				replaced = true
				break
			}
		}
		if !replaced {
			fields = append(fields, jsonField{key: key, value: value})
		}
		parser.skipSpace()
		if parser.consume('}') {
			return jsonValue{kind: jsonObject, fields: fields}, nil
		}
		if !parser.consume(',') {
			return jsonValue{}, fmt.Errorf("invalid json: expected comma or closing brace at byte %d", parser.index)
		}
	}
}

func (parser *jsonParser) parseArray() (jsonValue, error) {
	parser.index++
	var elements []jsonValue
	parser.skipSpace()
	if parser.consume(']') {
		return jsonValue{kind: jsonArray, elements: elements}, nil
	}
	for {
		element, err := parser.parseValue()
		if err != nil {
			return jsonValue{}, err
		}
		elements = append(elements, element)
		parser.skipSpace()
		if parser.consume(']') {
			return jsonValue{kind: jsonArray, elements: elements}, nil
		}
		if !parser.consume(',') {
			return jsonValue{}, fmt.Errorf("invalid json: expected comma or closing bracket at byte %d", parser.index)
		}
	}
}

func (parser *jsonParser) parseNumber() (jsonValue, error) {
	start := parser.index
	parser.consume('-')
	if parser.index >= len(parser.text) || !isDigit(parser.text[parser.index]) {
		return jsonValue{}, fmt.Errorf("invalid json: expected number at byte %d", start)
	}
	if parser.text[parser.index] == '0' {
		parser.index++
	} else {
		for parser.index < len(parser.text) && isDigit(parser.text[parser.index]) {
			parser.index++
		}
	}
	if parser.consume('.') {
		if parser.index >= len(parser.text) || !isDigit(parser.text[parser.index]) {
			return jsonValue{}, fmt.Errorf("invalid json: expected fraction at byte %d", parser.index)
		}
		for parser.index < len(parser.text) && isDigit(parser.text[parser.index]) {
			parser.index++
		}
	}
	if parser.index < len(parser.text) && (parser.text[parser.index] == 'e' || parser.text[parser.index] == 'E') {
		parser.index++
		if parser.index < len(parser.text) && (parser.text[parser.index] == '+' || parser.text[parser.index] == '-') {
			parser.index++
		}
		if parser.index >= len(parser.text) || !isDigit(parser.text[parser.index]) {
			return jsonValue{}, fmt.Errorf("invalid json: expected exponent at byte %d", parser.index)
		}
		for parser.index < len(parser.text) && isDigit(parser.text[parser.index]) {
			parser.index++
		}
	}
	number, err := strconv.ParseFloat(parser.text[start:parser.index], 64)
	if err != nil {
		return jsonValue{}, fmt.Errorf("invalid json: number %q", parser.text[start:parser.index])
	}
	return jsonValue{kind: jsonNumber, text: document.FormatJSONNumber(number)}, nil
}

func (parser *jsonParser) parseString() (string, error) {
	parser.index++
	var builder strings.Builder
	for parser.index < len(parser.text) {
		character := parser.text[parser.index]
		if character == '"' {
			parser.index++
			return builder.String(), nil
		}
		if character == '\\' {
			parser.index++
			if parser.index >= len(parser.text) {
				return "", fmt.Errorf("invalid json: truncated escape")
			}
			escaped := parser.text[parser.index]
			parser.index++
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
				character, err := parser.parseUnicodeEscape()
				if err != nil {
					return "", err
				}
				builder.WriteRune(character)
			default:
				return "", fmt.Errorf("invalid json: bad escape %q", escaped)
			}
			continue
		}
		if character < 0x20 {
			return "", fmt.Errorf("invalid json: raw control character at byte %d", parser.index)
		}
		decoded, size := utf8.DecodeRuneInString(parser.text[parser.index:])
		if decoded == utf8.RuneError && size == 1 {
			builder.WriteRune(utf8.RuneError)
			parser.index++
			continue
		}
		builder.WriteString(parser.text[parser.index : parser.index+size])
		parser.index += size
	}
	return "", fmt.Errorf("invalid json: unterminated string")
}

func (parser *jsonParser) parseUnicodeEscape() (rune, error) {
	character, err := parser.readHex4()
	if err != nil {
		return 0, err
	}
	if character < 0xD800 || character > 0xDBFF {
		return character, nil
	}
	if parser.index+1 < len(parser.text) && parser.text[parser.index] == '\\' && parser.text[parser.index+1] == 'u' {
		saved := parser.index
		parser.index += 2
		low, lowErr := parser.readHex4()
		if lowErr == nil && low >= 0xDC00 && low <= 0xDFFF {
			return (character-0xD800)*0x400 + (low - 0xDC00) + 0x10000, nil
		}
		parser.index = saved
	}
	// 片側だけのサロゲートは Go の文字列に置けないので U+FFFD にする
	return utf8.RuneError, nil
}

func (parser *jsonParser) readHex4() (rune, error) {
	if parser.index+4 > len(parser.text) {
		return 0, fmt.Errorf("invalid json: short unicode escape")
	}
	value := rune(0)
	for _, character := range parser.text[parser.index : parser.index+4] {
		value <<= 4
		switch {
		case character >= '0' && character <= '9':
			value += rune(character - '0')
		case character >= 'a' && character <= 'f':
			value += rune(character-'a') + 10
		case character >= 'A' && character <= 'F':
			value += rune(character-'A') + 10
		default:
			return 0, fmt.Errorf("invalid json: bad unicode escape")
		}
	}
	parser.index += 4
	return value, nil
}

func (parser *jsonParser) consume(character byte) bool {
	if parser.index < len(parser.text) && parser.text[parser.index] == character {
		parser.index++
		return true
	}
	return false
}

func isDigit(character byte) bool {
	return character >= '0' && character <= '9'
}

func objectField(value jsonValue, key string) (jsonValue, bool) {
	if value.kind != jsonObject {
		return jsonValue{}, false
	}
	for _, field := range value.fields {
		if field.key == key {
			return field.value, true
		}
	}
	return jsonValue{}, false
}

// stringifyJSON は JSON.stringify(value, null, 2)。文字列の escape は document.MarshalJavaScript が使えるときはそれに任せる
// document.MarshalJavaScript は 1 引数の JSON.stringify で、インデントも末尾の LF も付けない
// docs/spec/yaru-format.md の「JSON の escape」と「workspaces.json」
func stringifyJSON(value jsonValue) (string, error) {
	return stringifyJSONAt(value, "")
}

func stringifyJSONAt(value jsonValue, gap string) (string, error) {
	switch value.kind {
	case jsonNull:
		return "null", nil
	case jsonBool:
		if value.boolean {
			return "true", nil
		}
		return "false", nil
	case jsonNumber:
		return value.text, nil
	case jsonString:
		return quoteJSONString(value.text)
	case jsonArray:
		if len(value.elements) == 0 {
			return "[]", nil
		}
		indent := gap + "  "
		parts := make([]string, 0, len(value.elements))
		for _, element := range value.elements {
			encoded, err := stringifyJSONAt(element, indent)
			if err != nil {
				return "", err
			}
			parts = append(parts, encoded)
		}
		return "[\n" + indent + strings.Join(parts, ",\n"+indent) + "\n" + gap + "]", nil
	case jsonObject:
		if len(value.fields) == 0 {
			return "{}", nil
		}
		indent := gap + "  "
		parts := make([]string, 0, len(value.fields))
		for _, field := range value.fields {
			key, err := quoteJSONString(field.key)
			if err != nil {
				return "", err
			}
			encoded, err := stringifyJSONAt(field.value, indent)
			if err != nil {
				return "", err
			}
			parts = append(parts, key+": "+encoded)
		}
		return "{\n" + indent + strings.Join(parts, ",\n"+indent) + "\n" + gap + "}", nil
	default:
		return "", fmt.Errorf("invalid json value kind %d", value.kind)
	}
}

// quoteJSONString は JSON.stringify の文字列。escape は document.MarshalJavaScript に任せる
// workspaces.json 全体は JSON.stringify(value, null, 2) なので、インデントはこのパッケージで組む
// docs/spec/yaru-format.md の「JSON の escape」と「workspaces.json」
func quoteJSONString(text string) (string, error) {
	encoded, err := document.MarshalJavaScript(text)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
