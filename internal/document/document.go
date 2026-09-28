// .yaru の Markdown ファイル (frontmatter と本文) と、TS 版の JSON.stringify と同じバイト列の JSON を読み書きする土台
// TS 版の src/store.ts の parseFrontmatter と formatDocument、src/issue-events.ts と src/questions.ts の JSON.stringify に当たる
// 仕様は docs/spec/yaru-format.md
package document

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
func Parse(text string) (Document, error) {
	panic("not implemented: document.Parse")
}

// Format は TS 版の formatDocument と同じバイト列を返す
func Format(fields []Field, body string) string {
	panic("not implemented: document.Format")
}

// MarshalJavaScript は TS 版の JSON.stringify と同じバイト列の JSON を返す (HTML 向けの escape をせず、U+2028 と U+2029 は生のまま、末尾に改行を付けない)
func MarshalJavaScript(value any) ([]byte, error) {
	panic("not implemented: document.MarshalJavaScript")
}
