//declscope:namespace document

// .yaru の Markdown ファイル (frontmatter と本文) と、TS 版の JSON.stringify と同じバイト列の JSON を読み書きする土台
// TS 版の src/store.ts の parseFrontmatter と formatDocument、src/issue-events.ts と src/questions.ts の JSON.stringify に当たる
// 仕様は docs/spec/yaru-format.md
package document

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/aovoq/yaru/internal/errs"
)

// Field は frontmatter の 1 行。TS 版の [key, value] の組に当たり、書き出す順を保つ
type Field struct {
	Key   string
	Value string
}

// Document は読んだ 1 つのファイル。Meta は同じキーが複数あるとき後の値が勝つ (TS 版の Record への代入と同じ)
type Document struct {
	Meta map[string]string
	Body string
}

// Parse は TS 版の parseFrontmatter と同じ規則でファイルを読む。形が違えば error を返す
// 仕様は docs/spec/yaru-format.md の「共通の frontmatter」。元は src/store.ts:788-805
// 引用符、# コメント、型、複数行は解釈しない。コメントでも質問でも、壊れているときの文言は invalid issue file
func Parse(text string) (Document, error) {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return Document{}, errs.Wrap("invalid issue file", errs.ErrInvalidArgument)
	}
	// 開きの `---\n` は 4 バイト。閉じは位置 4 以降の最初の `\n---\n` (src/store.ts:791-792)
	closingOffset := strings.Index(normalized[4:], "\n---\n")
	if closingOffset < 0 {
		return Document{}, errs.Wrap("invalid issue file", errs.ErrInvalidArgument)
	}
	closingIndex := 4 + closingOffset
	raw := normalized[4:closingIndex]
	// 本文は先頭の LF を 1 つ、末尾の LF を 1 つだけ削る (src/store.ts:794-797)
	body := strings.TrimPrefix(normalized[closingIndex+5:], "\n")
	body = strings.TrimSuffix(body, "\n")
	metadata := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		separatorIndex := strings.Index(line, ":")
		if separatorIndex < 0 {
			continue
		}
		key := strings.TrimSpace(line[:separatorIndex])
		value := strings.TrimSpace(line[separatorIndex+1:])
		metadata[key] = value
	}
	return Document{Meta: metadata, Body: body}, nil
}

// Format は TS 版の formatDocument と同じバイト列を返す
// 空の値は `key:` 。それ以外はコロンの直後に半角スペースを 1 つ置いて値をそのまま続ける (src/store.ts:862-868)
func Format(fields []Field, body string) string {
	lines := make([]string, 0, len(fields))
	for _, field := range fields {
		if field.Value == "" {
			lines = append(lines, field.Key+":")
			continue
		}
		lines = append(lines, field.Key+": "+field.Value)
	}
	frontmatter := strings.Join(lines, "\n")
	return "---\n" + frontmatter + "\n---\n\n" + body + "\n"
}

// MarshalJavaScript は TS 版の JSON.stringify と同じバイト列の JSON を返す (HTML 向けの escape をせず、U+2028 と U+2029 は生のまま、末尾に改行を付けない)
// https://www.rfc-editor.org/rfc/rfc8259
// 差分の根拠は docs/spec/yaru-format.md の「JSON の escape」。呼び出しは src/issue-events.ts:60 と src/questions.ts:713
// map のキーは encoding/json が名前順に並べる。JSON.stringify の挿入順が要るときは、フィールドをその順に並べた struct を渡す
// nil の slice は null、長さ 0 の slice は [] になる
func MarshalJavaScript(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	encoded := bytes.TrimSuffix(buffer.Bytes(), []byte{'\n'})
	encoded = restoreUnicodeLineSeparators(encoded)
	// JSON.stringify(-0) は 0。encoding/json は -0 と書くので、文字列の外だけ 0 に戻す
	return restoreNegativeZero(encoded), nil
}

// restoreUnicodeLineSeparators は encoding/json が出す \u2028 と \u2029 を生の文字へ戻す
// 直前がもう一つのバックスラッシュである \\u2028 は、文字列としての \u2028 なので戻さない
func restoreUnicodeLineSeparators(encoded []byte) []byte {
	if !bytes.Contains(encoded, []byte(`\u202`)) {
		return encoded
	}
	restored := make([]byte, 0, len(encoded))
	for index := 0; index < len(encoded); {
		if encoded[index] == '\\' && index+1 < len(encoded) && encoded[index+1] == '\\' {
			restored = append(restored, '\\', '\\')
			index += 2
			continue
		}
		if encoded[index] == '\\' && index+6 <= len(encoded) && encoded[index+1] == 'u' {
			hexDigits := string(encoded[index+2 : index+6])
			if hexDigits == "2028" {
				restored = append(restored, "\u2028"...)
				index += 6
				continue
			}
			if hexDigits == "2029" {
				restored = append(restored, "\u2029"...)
				index += 6
				continue
			}
		}
		restored = append(restored, encoded[index])
		index++
	}
	return restored
}

// restoreNegativeZero は文字列の外にある数値 -0 を 0 にする。-0.5 のように続く数値は変えない
func restoreNegativeZero(encoded []byte) []byte {
	if !bytes.Contains(encoded, []byte("-0")) {
		return encoded
	}
	restored := make([]byte, 0, len(encoded))
	insideString := false
	for index := 0; index < len(encoded); {
		if insideString {
			restored = append(restored, encoded[index])
			if encoded[index] == '\\' && index+1 < len(encoded) {
				restored = append(restored, encoded[index+1])
				index += 2
				continue
			}
			if encoded[index] == '"' {
				insideString = false
			}
			index++
			continue
		}
		if encoded[index] == '"' {
			insideString = true
			restored = append(restored, '"')
			index++
			continue
		}
		if encoded[index] == '-' && index+2 <= len(encoded) && encoded[index+1] == '0' && !numberContinues(encoded, index+2) {
			restored = append(restored, '0')
			index += 2
			continue
		}
		restored = append(restored, encoded[index])
		index++
	}
	return restored
}

func numberContinues(encoded []byte, index int) bool {
	if index >= len(encoded) {
		return false
	}
	next := encoded[index]
	return next == '.' || next == 'e' || next == 'E' || (next >= '0' && next <= '9')
}
