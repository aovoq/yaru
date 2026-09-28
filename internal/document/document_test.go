// Parse・Format・MarshalJavaScript を、docs/spec/yaru-format.md のバイト列と src/store.ts の振る舞いで確かめる
package document_test

import (
	"math"
	"strings"
	"testing"

	"github.com/aovoq/yaru/internal/document"
)

// issueDocument は docs/spec/yaru-format.md の issue の例。本文は「1 行目、空行、2 行目、末尾の LF」
// formatDocument がさらに LF を足すので、ファイルは 2 行目の次の空行で終わる (src/store.ts:863-868)
const issueDocument = "---\n" +
	"id: 1\n" +
	"title: 本番: \"称号\" #1\n" +
	"status: done\n" +
	"assignee: Spec Author\n" +
	"labels: ui, 本番\n" +
	"dueDate: 2026-10-01\n" +
	"priority: high\n" +
	"parent:\n" +
	"blocks:\n" +
	"startedAt: 2026-09-25T09:00:00.000Z\n" +
	"completedAt: 2026-09-25T10:00:00.000Z\n" +
	"canceledAt:\n" +
	"createdAt: 2026-09-25T09:00:00.000Z\n" +
	"updatedAt: 2026-09-25T10:00:00.000Z\n" +
	"session: session-1\n" +
	"worktree: /work/feature\n" +
	"branch: feat/add-thing\n" +
	"---\n" +
	"\n" +
	"1 行目\n" +
	"\n" +
	"2 行目\n" +
	"\n"

func issueFields() []document.Field {
	return []document.Field{
		{Key: "id", Value: "1"},
		{Key: "title", Value: "本番: \"称号\" #1"},
		{Key: "status", Value: "done"},
		{Key: "assignee", Value: "Spec Author"},
		{Key: "labels", Value: "ui, 本番"},
		{Key: "dueDate", Value: "2026-10-01"},
		{Key: "priority", Value: "high"},
		{Key: "parent", Value: ""},
		{Key: "blocks", Value: ""},
		{Key: "startedAt", Value: "2026-09-25T09:00:00.000Z"},
		{Key: "completedAt", Value: "2026-09-25T10:00:00.000Z"},
		{Key: "canceledAt", Value: ""},
		{Key: "createdAt", Value: "2026-09-25T09:00:00.000Z"},
		{Key: "updatedAt", Value: "2026-09-25T10:00:00.000Z"},
		{Key: "session", Value: "session-1"},
		{Key: "worktree", Value: "/work/feature"},
		{Key: "branch", Value: "feat/add-thing"},
	}
}

func TestFormatWritesTheIssueExample(t *testing.T) {
	actual := document.Format(issueFields(), "1 行目\n\n2 行目\n")
	if actual != issueDocument {
		t.Fatalf("expected %q, actual %q", issueDocument, actual)
	}
}

func TestFormatWritesEmptyValuesWithoutTrailingSpace(t *testing.T) {
	// 空の値は `key:` 。コロンの後ろに空白を置かない (src/store.ts:862-868, src/store.test.ts:603-614)
	actual := document.Format([]document.Field{
		{Key: "id", Value: "2"},
		{Key: "parent", Value: ""},
		{Key: "title", Value: "child"},
	}, "")
	expected := "---\nid: 2\nparent:\ntitle: child\n---\n\n\n"
	if actual != expected {
		t.Fatalf("expected %q, actual %q", expected, actual)
	}
}

func TestFormatKeepsSpacesInsideNonEmptyValues(t *testing.T) {
	// 値が空でないときは前後の空白を削らない。`labels:  a ` のコードポイントは labels、コロン、32、32、97、32
	// docs/spec/yaru-format.md の「共通の frontmatter」
	actual := document.Format([]document.Field{
		{Key: "labels", Value: " a "},
		{Key: "title", Value: ""},
		{Key: "note", Value: "  x  "},
	}, "b")
	expected := "---\nlabels:  a \ntitle:\nnote:   x  \n---\n\nb\n"
	if actual != expected {
		t.Fatalf("expected %q, actual %q", expected, actual)
	}
	if !strings.Contains(actual, "labels:  a \n") {
		t.Fatalf("expected the labels line to keep the trailing space, actual %q", actual)
	}
}

func TestFormatDoesNotEscape(t *testing.T) {
	// 引用符、エスケープ、折返しは付けない。値の改行もそのまま出る (src/store.ts:863-868)
	actual := document.Format([]document.Field{
		{Key: "title", Value: "a\nb"},
		{Key: "weird", Value: "---"},
		{Key: "colon", Value: "a:b"},
		{Key: "", Value: ""},
		{Key: "", Value: "v"},
	}, "see\n---\nthis")
	expected := "---\ntitle: a\nb\nweird: ---\ncolon: a:b\n:\n: v\n---\n\nsee\n---\nthis\n"
	if actual != expected {
		t.Fatalf("expected %q, actual %q", expected, actual)
	}
}

func TestFormatKeepsDuplicateKeys(t *testing.T) {
	actual := document.Format([]document.Field{
		{Key: "id", Value: "1"},
		{Key: "id", Value: "2"},
	}, "")
	expected := "---\nid: 1\nid: 2\n---\n\n\n"
	if actual != expected {
		t.Fatalf("expected %q, actual %q", expected, actual)
	}
}

func TestParseReadsTheIssueExample(t *testing.T) {
	actual, err := document.Parse(issueDocument)
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]string{
		"id":          "1",
		"title":       "本番: \"称号\" #1",
		"status":      "done",
		"assignee":    "Spec Author",
		"labels":      "ui, 本番",
		"dueDate":     "2026-10-01",
		"priority":    "high",
		"parent":      "",
		"blocks":      "",
		"startedAt":   "2026-09-25T09:00:00.000Z",
		"completedAt": "2026-09-25T10:00:00.000Z",
		"canceledAt":  "",
		"createdAt":   "2026-09-25T09:00:00.000Z",
		"updatedAt":   "2026-09-25T10:00:00.000Z",
		"session":     "session-1",
		"worktree":    "/work/feature",
		"branch":      "feat/add-thing",
	}
	assertMeta(t, expected, actual.Meta)
	if actual.Body != "1 行目\n\n2 行目\n" {
		t.Fatalf("expected body %q, actual %q", "1 行目\n\n2 行目\n", actual.Body)
	}
}

func TestParseRejectsAFileThatIsNotFrontmatter(t *testing.T) {
	// コメントや質問でも文言は invalid issue file (src/store.ts:790, src/store.ts:792)
	texts := []string{
		"",
		"   ",
		"hello",
		"---",
		"---\nkey: value\n",
		"---\n---\n",
		"---\n---\n\n",
		"\uFEFF---\nid: 1\n---\n\n",
		"\n---\nid: 1\n---\n\n",
		"---\nid: 1\n--- \n\nbody\n",
		"---\rkey: v\r---\r\rbody\r",
	}
	for _, text := range texts {
		_, err := document.Parse(text)
		if err == nil {
			t.Fatalf("expected invalid issue file for %q", text)
		}
		if err.Error() != "invalid issue file" {
			t.Fatalf("expected invalid issue file, actual %q", err.Error())
		}
	}
}

func TestParseFollowsTheFrontmatterRules(t *testing.T) {
	cases := []struct {
		name string
		text string
		meta map[string]string
		body string
	}{
		{
			name: "blank line before the closer",
			text: "---\n\n---\n",
			meta: map[string]string{},
			body: "",
		},
		{
			name: "closer without a blank line before the body",
			text: "---\nkey: value\n---\nbody",
			meta: map[string]string{"key": "value"},
			body: "body",
		},
		{
			name: "carriage return plus line feed becomes a line feed",
			text: "---\r\nkey: value\r\n---\r\n\r\nbody\r\n",
			meta: map[string]string{"key": "value"},
			body: "body",
		},
		{
			name: "a lone carriage return stays",
			text: "---\nkey: a\rb\n---\n\nbody\r",
			meta: map[string]string{"key": "a\rb"},
			body: "body\r",
		},
		{
			name: "the later duplicate key wins",
			text: "---\nid: 1\nid: 2\ntitle: a\n---\n\nx\n",
			meta: map[string]string{"id": "2", "title": "a"},
			body: "x",
		},
		{
			name: "a line without a colon is dropped",
			text: "---\nhello\nid: 1\n# comment\n---\n\n",
			meta: map[string]string{"id": "1"},
			body: "",
		},
		{
			name: "quotes comments and scalars stay text",
			text: "---\ntitle: \"quoted\"\nnote: hello # note\nflag: true\nnil: null\nnum: 1\n---\n\n",
			meta: map[string]string{
				"title": "\"quoted\"",
				"note":  "hello # note",
				"flag":  "true",
				"nil":   "null",
				"num":   "1",
			},
			body: "",
		},
		{
			name: "keys and values are trimmed",
			text: "---\n key :  a \nlabels:  a \n---\n\n",
			meta: map[string]string{"key": "a", "labels": "a"},
			body: "",
		},
		{
			name: "the first colon splits the line",
			text: "---\na:b:c\n---\n\n",
			meta: map[string]string{"a": "b:c"},
			body: "",
		},
		{
			name: "an empty key is kept and the later line wins",
			text: "---\n: value\n  : x\n:\n---\n\n",
			meta: map[string]string{"": ""},
			body: "",
		},
		{
			name: "a later separator in the body stays in the body",
			text: "---\nid: 1\n---\n\nkeep\n---\nrest\n",
			meta: map[string]string{"id": "1"},
			body: "keep\n---\nrest",
		},
		{
			name: "only one leading and one trailing newline are removed from the body",
			text: "---\nid: 1\n---\n\n\nhello\n\n",
			meta: map[string]string{"id": "1"},
			body: "\nhello\n",
		},
		{
			name: "a tab around a value is trimmed",
			text: "---\ntitle:\thello\t\n---\n\n",
			meta: map[string]string{"title": "hello"},
			body: "",
		},
		{
			name: "unknown keys stay",
			text: "---\nid: 1\nextra: 1\n---\n\n本文\n",
			meta: map[string]string{"id": "1", "extra": "1"},
			body: "本文",
		},
		{
			name: "the answer separator stays in the body",
			text: "---\nid: 1\n---\n\n質問\n\n<!-- yaru:answer -->\n\nyes\n",
			meta: map[string]string{"id": "1"},
			body: "質問\n\n<!-- yaru:answer -->\n\nyes",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			actual, err := document.Parse(testCase.text)
			if err != nil {
				t.Fatal(err)
			}
			assertMeta(t, testCase.meta, actual.Meta)
			if actual.Body != testCase.body {
				t.Fatalf("expected body %q, actual %q", testCase.body, actual.Body)
			}
		})
	}
}

func TestParseThenFormatRoundTripsWhenValuesAreAlreadyTrimmed(t *testing.T) {
	fields := []document.Field{
		{Key: "id", Value: "1"},
		{Key: "title", Value: "hello"},
		{Key: "parent", Value: ""},
	}
	formatted := document.Format(fields, "本文\n")
	actual, err := document.Parse(formatted)
	if err != nil {
		t.Fatal(err)
	}
	assertMeta(t, map[string]string{"id": "1", "title": "hello", "parent": ""}, actual.Meta)
	if actual.Body != "本文\n" {
		t.Fatalf("expected body %q, actual %q", "本文\n", actual.Body)
	}
}

func TestMarshalJavaScriptWritesEventLines(t *testing.T) {
	// キー順は field, from, to, by, session, at (src/issue-events.ts:60)
	status := struct {
		Field   string `json:"field"`
		From    string `json:"from"`
		To      string `json:"to"`
		By      string `json:"by"`
		Session string `json:"session"`
		At      string `json:"at"`
	}{
		Field:   "status",
		From:    "in_progress",
		To:      "done",
		By:      "Spec Author",
		Session: "session-1",
		At:      "2026-09-25T10:00:00.000Z",
	}
	assertJSON(t, status, `{"field":"status","from":"in_progress","to":"done","by":"Spec Author","session":"session-1","at":"2026-09-25T10:00:00.000Z"}`)

	labels := struct {
		Field   string   `json:"field"`
		From    []string `json:"from"`
		To      []string `json:"to"`
		By      string   `json:"by"`
		Session any      `json:"session"`
		At      string   `json:"at"`
	}{
		Field:   "labels",
		From:    []string{},
		To:      []string{"ui", "本番"},
		By:      "Spec Author",
		Session: nil,
		At:      "2026-09-25T09:00:00.000Z",
	}
	assertJSON(t, labels, `{"field":"labels","from":[],"to":["ui","本番"],"by":"Spec Author","session":null,"at":"2026-09-25T09:00:00.000Z"}`)

	title := struct {
		Field   string `json:"field"`
		From    string `json:"from"`
		To      string `json:"to"`
		By      string `json:"by"`
		Session any    `json:"session"`
		At      string `json:"at"`
	}{
		Field:   "title",
		From:    "a",
		To:      "b\nc",
		By:      "Spec Author",
		Session: nil,
		At:      "2026-09-25T09:00:00.000Z",
	}
	assertJSON(t, title, "{\"field\":\"title\",\"from\":\"a\",\"to\":\"b\\nc\",\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T09:00:00.000Z\"}")
}

func TestMarshalJavaScriptWritesQuestionOptions(t *testing.T) {
	// docs/spec/yaru-format.md の question の例。options は JSON.stringify の 1 引数 (src/questions.ts:713)
	assertJSON(t, []string{"残す", "消す, ただし \"本番\" だけ", "a\\b"}, `["残す","消す, ただし \"本番\" だけ","a\\b"]`)
}

func TestMarshalJavaScriptEscapesLikeJSONStringify(t *testing.T) {
	// docs/spec/yaru-format.md の「JSON の escape」。U+0000 から U+001F だけを escape し、< > & と DEL と U+2028 と U+2029 は生
	var input strings.Builder
	var expected strings.Builder
	expected.WriteByte('"')
	for code := 0; code <= 0x1f; code++ {
		input.WriteRune(rune(code))
		switch code {
		case 0x08:
			expected.WriteString(`\b`)
		case 0x09:
			expected.WriteString(`\t`)
		case 0x0a:
			expected.WriteString(`\n`)
		case 0x0c:
			expected.WriteString(`\f`)
		case 0x0d:
			expected.WriteString(`\r`)
		default:
			expected.WriteString(`\u00`)
			expected.WriteByte("0123456789abcdef"[code>>4])
			expected.WriteByte("0123456789abcdef"[code&0x0f])
		}
	}
	input.WriteString(" \"\\/<>&\u007f\u2028\u2029日本語")
	expected.WriteString(" \\\"\\\\/<>&\u007f\u2028\u2029日本語\"")
	assertJSON(t, input.String(), expected.String())
}

func TestMarshalJavaScriptKeepsALiteralUnicodeEscape(t *testing.T) {
	// 文字列としての \u2028 を、生の U+2028 へ戻す処理で壊さない
	assertJSON(t, "\\u2028", `"\\u2028"`)
	assertJSON(t, "a\\u2028b\u2028c\\u2029d\u2029", "\"a\\\\u2028b\u2028c\\\\u2029d\u2029\"")
}

func TestMarshalJavaScriptMatchesJSONStringifyNumbers(t *testing.T) {
	assertJSON(t, 0, "0")
	assertJSON(t, math.Copysign(0, -1), "0")
	assertJSON(t, -0.5, "-0.5")
	assertJSON(t, "-0", `"-0"`)
	assertJSON(t, struct {
		Value float64 `json:"value"`
	}{Value: math.Copysign(0, -1)}, `{"value":0}`)
	assertJSON(t, 1, "1")
	assertJSON(t, -1, "-1")
	assertJSON(t, 1.5, "1.5")
	assertJSON(t, true, "true")
	assertJSON(t, false, "false")
	assertJSON(t, nil, "null")
	assertJSON(t, []string{}, "[]")
	assertJSON(t, 1e21, "1e+21")
	assertJSON(t, 1e20, "100000000000000000000")
	assertJSON(t, 1e-7, "1e-7")
	assertJSON(t, 1e-6, "0.000001")
	assertJSON(t, math.MaxFloat64, "1.7976931348623157e+308")
	assertJSON(t, math.SmallestNonzeroFloat64, "5e-324")
	assertJSON(t, float64(9007199254740991), "9007199254740991")
	var noLabels []string
	assertJSON(t, noLabels, "null")
}

func TestMarshalJavaScriptRejectsNotANumber(t *testing.T) {
	// encoding/json は NaN を受けない。JSON.stringify は null にする。この差は REPORT.md に書く
	_, err := document.MarshalJavaScript(math.NaN())
	if err == nil {
		t.Fatal("expected an error for NaN")
	}
}

func assertMeta(t *testing.T, expected map[string]string, actual map[string]string) {
	t.Helper()
	if actual == nil {
		t.Fatal("expected a meta map, actual nil")
	}
	if len(actual) != len(expected) {
		t.Fatalf("expected %d keys %#v, actual %#v", len(expected), expected, actual)
	}
	for key, expectedValue := range expected {
		actualValue, ok := actual[key]
		if !ok || actualValue != expectedValue {
			t.Fatalf("key %q: expected %q, actual %q", key, expectedValue, actualValue)
		}
	}
}

func assertJSON(t *testing.T, value any, expected string) {
	t.Helper()
	actual, err := document.MarshalJavaScript(value)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != expected {
		t.Fatalf("expected %q, actual %q", expected, string(actual))
	}
	if len(actual) > 0 && actual[len(actual)-1] == '\n' {
		t.Fatalf("expected no trailing newline, actual %q", string(actual))
	}
}
