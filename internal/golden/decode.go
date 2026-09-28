package golden

import "unicode/utf8"

// decodeUTF8 は TextDecoder (fatal でない UTF-8) と同じく、壊れた並びを「最大の部分」ごとに 1 つの U+FFFD にする
// Go の utf8.DecodeRune は 1 バイトずつ置き換えるので、途中で切れた並び (E3 81 など) の数え方が違う
// https://encoding.spec.whatwg.org/#utf-8-decoder
//
//declscope:package
func decodeUTF8(content []byte) string {
	if utf8.Valid(content) {
		return string(content)
	}
	decoded := make([]byte, 0, len(content)+8)
	for index := 0; index < len(content); {
		character, size := utf8.DecodeRune(content[index:])
		if character != utf8.RuneError || size > 1 {
			decoded = append(decoded, content[index:index+size]...)
			index += size
			continue
		}
		decoded = utf8.AppendRune(decoded, utf8.RuneError)
		index += maximalSubpartLength(content[index:])
	}
	return string(decoded)
}

// maximalSubpartLength は先頭の壊れた並びのうち、正しい並びの頭として読めるバイト数 (1 以上)
func maximalSubpartLength(content []byte) int {
	lead := content[0]
	needed := 0
	lower, upper := byte(0x80), byte(0xbf)
	switch {
	case 0xc2 <= lead && lead <= 0xdf:
		needed = 1
	case 0xe0 <= lead && lead <= 0xef:
		needed = 2
		if lead == 0xe0 {
			lower = 0xa0
		}
		if lead == 0xed {
			upper = 0x9f
		}
	case 0xf0 <= lead && lead <= 0xf4:
		needed = 3
		if lead == 0xf0 {
			lower = 0x90
		}
		if lead == 0xf4 {
			upper = 0x8f
		}
	default:
		return 1
	}
	length := 1
	for length <= needed && length < len(content) {
		if content[length] < lower || content[length] > upper {
			break
		}
		lower, upper = 0x80, 0xbf
		length++
	}
	return length
}
