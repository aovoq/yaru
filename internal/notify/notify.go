// 質問を作ったときの知らせ。TS 版の src/notify.ts
// 失敗しても質問は保存済みなので、戻り値の警告文を CLI が標準エラーへ出す (src/notify.ts:54-68)
package notify

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/workspace"
)

// BaseURL は src/notify.ts:50 の notifyBaseUrl。config.yml の publicUrl が無ければ fallback
func BaseURL(opened workspace.Workspace, fallback string) (string, error) {
	panic("not implemented: notify.BaseURL")
}

// QuestionURL は src/notify.ts:40-42。fragment は dashboard の質問カード
// https://www.rfc-editor.org/rfc/rfc3986#section-3.5
func QuestionURL(baseURL string, slug string, questionID string) string {
	return strings.TrimRight(baseURL, "/") + "/p/" + EncodeURIComponent(slug) + "/dashboard#q-" + EncodeURIComponent(questionID)
}

// QuestionCreated は event question.created を config.yml の notify コマンドへ送る
// 送り先が無い、または終了コード 0 なら警告文は空。失敗なら src/notify.ts:185-192 の文を返す
func QuestionCreated(opened workspace.Workspace, url string, question questions.Question) (string, error) {
	panic("not implemented: notify.QuestionCreated")
}

// EncodeURIComponent は JS の encodeURIComponent。残す文字は A-Z a-z 0-9 と - _ . ! ~ * ' ( )
// hintBoard (src/index.ts:741) と questionUrl (src/notify.ts:41) の両方が使う
func EncodeURIComponent(value string) string {
	var builder strings.Builder
	for _, character := range value {
		if isURIUnescaped(character) {
			builder.WriteRune(character)
			continue
		}
		var encoded [utf8.UTFMax]byte
		count := utf8.EncodeRune(encoded[:], character)
		for index := 0; index < count; index++ {
			fmt.Fprintf(&builder, "%%%02X", encoded[index])
		}
	}
	return builder.String()
}

func isURIUnescaped(character rune) bool {
	if character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z' || character >= '0' && character <= '9' {
		return true
	}
	switch character {
	case '-', '_', '.', '!', '~', '*', '\'', '(', ')':
		return true
	default:
		return false
	}
}
