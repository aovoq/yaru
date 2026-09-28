package store

import (
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// commentRun は土台 (document・clock・workspace) が panic している間、そのテストを飛ばす
// 司令塔が土台を入れたあとは、同じテストが本物のバイト列を確かめる
func commentRun(t *testing.T, run func() error) error {
	t.Helper()
	var recovered any
	err := func() (err error) {
		defer func() { recovered = recover() }()
		return run()
	}()
	if recovered != nil {
		message := fmt.Sprint(recovered)
		if strings.Contains(message, "not implemented:") {
			t.Skip(message)
		}
		panic(recovered)
	}
	return err
}

func commentString(value string) *string {
	return &value
}

func commentMust(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func commentTestDirectory(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Setenv("YARU_STATE_DIR", filepath.Join(t.TempDir(), "state"))
	t.Setenv("HOME", t.TempDir())
	t.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	t.Setenv("TZ", "Asia/Tokyo")
	t.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Chdir(root)
	commentMust(t, exec.Command("git", "init").Run())
	commentMust(t, exec.Command("git", "config", "user.name", "Spec Author").Run())
	commentMust(t, exec.Command("git", "config", "user.email", "spec@example.com").Run())
	directory := filepath.Join(root, ".yaru")
	commentMust(t, os.MkdirAll(filepath.Join(directory, "issues"), 0o777))
	commentMust(t, os.MkdirAll(filepath.Join(directory, "comments"), 0o777))
	commentMust(t, os.WriteFile(filepath.Join(directory, "config.yml"), nil, 0o666))
	commentTestWriteIssue(t, directory, "1", "todo", "", "")
	return directory
}

func commentTestWriteIssue(t *testing.T, directory string, issueID string, status string, dueDate string, priority string) {
	t.Helper()
	text := strings.Join([]string{
		"---",
		"id: " + issueID,
		"title: topic",
		"status: " + status,
		"assignee:",
		"labels:",
		"dueDate: " + dueDate,
		"priority: " + priority,
		"parent:",
		"blocks:",
		"startedAt:",
		"completedAt:",
		"canceledAt:",
		"createdAt: 2026-09-28T12:00:00.000Z",
		"updatedAt: 2026-09-28T12:00:00.000Z",
		"session:",
		"worktree:",
		"branch:",
		"---",
		"",
		"",
	}, "\n")
	if dueDate == "" {
		text = strings.Replace(text, "dueDate: \n", "dueDate:\n", 1)
	}
	if priority == "" {
		text = strings.Replace(text, "priority: \n", "priority:\n", 1)
	}
	commentMust(t, os.WriteFile(filepath.Join(directory, "issues", issueID+".md"), []byte(text), 0o666))
}

func commentEqual(t *testing.T, got Comment, want Comment) {
	t.Helper()
	if got.ID != want.ID || got.Issue != want.Issue || got.Author != want.Author || got.CreatedAt != want.CreatedAt || got.UpdatedAt != want.UpdatedAt || got.Body != want.Body {
		t.Fatalf("comment = %+v, want %+v", got, want)
	}
	switch {
	case got.Parent == nil && want.Parent == nil:
	case got.Parent != nil && want.Parent != nil && *got.Parent == *want.Parent:
	default:
		t.Fatalf("parent = %v, want %v", commentPointer(got.Parent), commentPointer(want.Parent))
	}
}

func commentPointer(value *string) string {
	if value == nil {
		return "null"
	}
	return *value
}

func TestGetCommentMissing(t *testing.T) {
	directory := t.TempDir()
	_, err := GetComment(directory, "9")
	if err == nil || err.Error() != "comment not found: 9" {
		t.Fatalf("error = %v, want comment not found: 9", err)
	}
}

func TestGetCommentEmptyID(t *testing.T) {
	directory := t.TempDir()
	_, err := GetComment(directory, "")
	if err == nil || err.Error() != "comment not found: " {
		t.Fatalf("error = %v, want comment not found: ", err)
	}
}

func TestGetCommentDirectory(t *testing.T) {
	directory := t.TempDir()
	commentMust(t, os.MkdirAll(filepath.Join(directory, "comments", "dir.md"), 0o777))
	_, err := GetComment(directory, "dir")
	if err == nil || err.Error() != "EISDIR: illegal operation on a directory, read" {
		t.Fatalf("error = %v, want EISDIR", err)
	}
}

func TestCommentJavaScriptTrim(t *testing.T) {
	// src/store.ts:665 の trim。U+0085 は削らず、U+FEFF と U+2028 は削る
	if got := commentJavaScriptTrim(" \n\t"); got != "" {
		t.Fatalf("trim = %q", got)
	}
	if got := commentJavaScriptTrim("\uFEFF"); got != "" {
		t.Fatalf("feff trim = %q", got)
	}
	if got := commentJavaScriptTrim("\u2028"); got != "" {
		t.Fatalf("line separator trim = %q", got)
	}
	if got := commentJavaScriptTrim("\u3000"); got != "" {
		t.Fatalf("ideographic space trim = %q", got)
	}
	if got := commentJavaScriptTrim("\u0085x"); got != "\u0085x" {
		t.Fatalf("nel trim = %q", got)
	}
	if got := commentJavaScriptTrim("  a  "); got != "a" {
		t.Fatalf("trim = %q", got)
	}
}

func TestCommentBlankToNull(t *testing.T) {
	// src/store.ts:400-405 と src/store.ts:746。none と空白は null
	if commentBlankToNull("") != nil || commentBlankToNull(" none ") != nil || commentBlankToNull("  ") != nil {
		t.Fatal("blank parent should be null")
	}
	got := commentBlankToNull("  p1  ")
	if got == nil || *got != "p1" {
		t.Fatalf("parent = %v", got)
	}
	kept := commentBlankToNull("none-more")
	if kept == nil || *kept != "none-more" {
		t.Fatalf("parent = %v", kept)
	}
}

func TestCommentIsCalendarDate(t *testing.T) {
	// docs/spec/yaru-format.md の dueDate。0000-0099 は JS の Date が 1900 年代にずらす
	// https://tc39.es/ecma262/#sec-date-year-month-date
	if !commentIsCalendarDate("2024-02-29") || !commentIsCalendarDate("0100-01-01") || !commentIsCalendarDate("2026-09-28") {
		t.Fatal("expected valid dates")
	}
	for _, value := range []string{"2026-02-29", "2026-02-30", "0001-01-01", "2026-08-20T00:00:00Z", "20260820"} {
		if commentIsCalendarDate(value) {
			t.Fatalf("%s should be invalid", value)
		}
	}
}

func TestCommentFormatJavaScriptNumber(t *testing.T) {
	// src/store.ts:726-737 の Number と String。1e21 以上は指数表記
	cases := []struct {
		value float64
		want  string
	}{
		{0, "0"},
		{1, "1"},
		{9007199254740992, "9007199254740992"},
		{1e20, "100000000000000000000"},
		{1e21, "1e+21"},
		{1e22, "1e+22"},
	}
	for _, test := range cases {
		if got := commentFormatJavaScriptNumber(test.value); got != test.want {
			t.Fatalf("format(%v) = %s, want %s", test.value, got, test.want)
		}
	}
	if got := commentFormatJavaScriptNumber(math.Inf(1)); got != "Infinity" {
		t.Fatalf("infinity = %s", got)
	}
}

func TestCommentNextID(t *testing.T) {
	directory := t.TempDir()
	got, err := commentNextID(directory)
	commentMust(t, err)
	if got != "1" {
		t.Fatalf("empty = %s", got)
	}
	comments := filepath.Join(directory, "comments")
	commentMust(t, os.Mkdir(comments, 0o777))
	commentMust(t, os.WriteFile(filepath.Join(comments, "notes.md"), []byte("x"), 0o666))
	commentMust(t, os.WriteFile(filepath.Join(comments, "01.md"), []byte("x"), 0o666))
	got, err = commentNextID(directory)
	commentMust(t, err)
	if got != "2" {
		t.Fatalf("after 01 = %s", got)
	}
	commentMust(t, os.WriteFile(filepath.Join(comments, "10.md"), []byte("x"), 0o666))
	got, err = commentNextID(directory)
	commentMust(t, err)
	if got != "11" {
		t.Fatalf("after 10 = %s", got)
	}
	commentMust(t, os.WriteFile(filepath.Join(comments, "9007199254740993.md"), []byte("x"), 0o666))
	got, err = commentNextID(directory)
	commentMust(t, err)
	if got != "9007199254740992" {
		t.Fatalf("unsafe integer = %s", got)
	}
}

func TestCommentCompare(t *testing.T) {
	// src/store.ts:651 の localeCompare。en-US では小文字が大文字より前で、"10" は "2" より前
	pairs := []struct {
		left  string
		right string
		want  int
	}{
		{"10", "2", -1},
		{"2", "10", 1},
		{"a", "A", -1},
		{"A", "b", -1},
		{"notes", "Notes", -1},
		{"e", "é", -1},
		{"E", "é", -1},
		{"a\u0301", "á", 0},
		{"9", "10", 1},
	}
	for _, pair := range pairs {
		if got := commentCompare(pair.left, pair.right); got != pair.want {
			t.Fatalf("compare(%q, %q) = %d, want %d", pair.left, pair.right, got, pair.want)
		}
	}
}

func TestCommentJoinOr(t *testing.T) {
	// src/store.ts:450-452
	if got := commentJoinOr([]string{"backlog", "todo", "in_progress", "done", "canceled"}); got != "backlog, todo, in_progress, done, or canceled" {
		t.Fatal(got)
	}
	if got := commentJoinOr([]string{"urgent", "high", "medium", "low"}); got != "urgent, high, medium, or low" {
		t.Fatal(got)
	}
}

func TestCommentReadStaleAfter(t *testing.T) {
	directory := t.TempDir()
	got, err := commentReadStaleAfter(directory)
	commentMust(t, err)
	if got != 24*3_600_000 {
		t.Fatalf("default = %d", got)
	}
	config := filepath.Join(directory, "config.yml")
	commentMust(t, os.WriteFile(config, []byte("staleAfter:\nstaleAfter: nope\n"), 0o666))
	got, err = commentReadStaleAfter(directory)
	commentMust(t, err)
	if got != 24*3_600_000 {
		t.Fatalf("empty first line = %d", got)
	}
	commentMust(t, os.WriteFile(config, []byte("notify: echo\nstaleAfter: 90m\n"), 0o666))
	got, err = commentReadStaleAfter(directory)
	commentMust(t, err)
	if got != 90*60_000 {
		t.Fatalf("90m = %d", got)
	}
	if got, err := commentParseStaleAfter(" 2h "); err != nil || got != 2*3_600_000 {
		t.Fatalf("2h = %d, %v", got, err)
	}
	if got, err := commentParseStaleAfter("3d"); err != nil || got != 3*86_400_000 {
		t.Fatalf("3d = %d, %v", got, err)
	}
	err = commentRun(t, func() error {
		_, parseErr := commentParseStaleAfter("0h")
		return parseErr
	})
	if err == nil || err.Error() != `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual "0h"` {
		t.Fatalf("error = %v", err)
	}
}

func TestCommentMkdirWhenPathIsFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "comments")
	commentMust(t, os.WriteFile(path, []byte("x"), 0o666))
	err := commentMkdir(path)
	want := fmt.Sprintf("EEXIST: file already exists, mkdir '%s'", path)
	if err == nil || err.Error() != want {
		t.Fatalf("error = %v, want %s", err, want)
	}
}

func TestCommentReplace(t *testing.T) {
	path := filepath.Join(t.TempDir(), "1.md")
	commentMust(t, commentReplace(path, "hello\n"))
	got, err := os.ReadFile(path)
	commentMust(t, err)
	if string(got) != "hello\n" {
		t.Fatalf("body = %q", got)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("temporary file remains")
	}
}

func TestCommentCreateExclusiveRetries(t *testing.T) {
	directory := t.TempDir()
	attempts := 0
	commentID, err := commentCreateWithRetry(directory, func(commentID string) (string, error) {
		attempts++
		if attempts == 1 {
			commentMust(t, os.MkdirAll(filepath.Join(directory, "comments"), 0o777))
			commentMust(t, os.WriteFile(commentPath(directory, commentID), []byte("race"), 0o666))
		}
		return "body-" + commentID, nil
	})
	commentMust(t, err)
	if commentID != "2" || attempts != 2 {
		t.Fatalf("id = %s, attempts = %d", commentID, attempts)
	}
	got, err := os.ReadFile(commentPath(directory, "2"))
	commentMust(t, err)
	if string(got) != "body-2" {
		t.Fatalf("body = %q", got)
	}
	err = commentCreateExclusive(commentPath(directory, "2"), "again")
	if !errors.Is(err, os.ErrExist) {
		t.Fatalf("second create = %v", err)
	}
}

func TestSaveCommentBytes(t *testing.T) {
	directory := commentTestDirectory(t)
	t.Setenv("YARU_NOW", "2026-09-28T12:05:00.000Z")
	var created Comment
	err := commentRun(t, func() error {
		var saveErr error
		created, saveErr = SaveComment(directory, SaveCommentInput{Issue: commentString("1"), Body: commentString("コメント\n次の行")})
		return saveErr
	})
	commentMust(t, err)
	commentEqual(t, created, Comment{
		ID:        "1",
		Issue:     "1",
		Author:    "Spec Author",
		CreatedAt: "2026-09-28T12:05:00.000Z",
		UpdatedAt: "2026-09-28T12:05:00.000Z",
		Body:      "コメント\n次の行",
	})
	got, err := os.ReadFile(commentPath(directory, "1"))
	commentMust(t, err)
	want := "---\nid: 1\nissue: 1\nparent:\nauthor: Spec Author\ncreatedAt: 2026-09-28T12:05:00.000Z\nupdatedAt: 2026-09-28T12:05:00.000Z\n---\n\nコメント\n次の行\n"
	if string(got) != want {
		t.Fatalf("bytes = %q, want %q", got, want)
	}
}

func TestSaveCommentReplyKeepsSpaces(t *testing.T) {
	directory := commentTestDirectory(t)
	err := commentRun(t, func() error {
		if _, saveErr := SaveComment(directory, SaveCommentInput{Issue: commentString("1"), Body: commentString("first")}); saveErr != nil {
			return saveErr
		}
		reply, saveErr := SaveComment(directory, SaveCommentInput{Issue: commentString("999"), Parent: commentString("1"), Body: commentString("  reply  ")})
		if saveErr != nil {
			return saveErr
		}
		if reply.ID != "2" || reply.Issue != "1" || reply.Parent == nil || *reply.Parent != "1" || reply.Body != "  reply  " {
			return fmt.Errorf("reply = %+v", reply)
		}
		return nil
	})
	commentMust(t, err)
	got, err := os.ReadFile(commentPath(directory, "2"))
	commentMust(t, err)
	if !strings.Contains(string(got), "\nparent: 1\n") || !strings.Contains(string(got), "\n\n  reply  \n") {
		t.Fatalf("bytes = %q", got)
	}
}

func TestSaveCommentUpdate(t *testing.T) {
	directory := commentTestDirectory(t)
	err := commentRun(t, func() error {
		if _, saveErr := SaveComment(directory, SaveCommentInput{Issue: commentString("1"), Body: commentString("first")}); saveErr != nil {
			return saveErr
		}
		t.Setenv("YARU_NOW", "2026-09-28T13:00:00.000Z")
		kept, saveErr := SaveComment(directory, SaveCommentInput{ID: commentString("1")})
		if saveErr != nil {
			return saveErr
		}
		if kept.Body != "first" || kept.UpdatedAt != "2026-09-28T13:00:00.000Z" || kept.CreatedAt != "2026-09-28T12:00:00.000Z" {
			return fmt.Errorf("kept = %+v", kept)
		}
		t.Setenv("YARU_NOW", "2026-09-28T14:00:00.000Z")
		edited, saveErr := SaveComment(directory, SaveCommentInput{ID: commentString("1"), Issue: commentString("9"), Parent: commentString("9"), Body: commentString("edited\n")})
		if saveErr != nil {
			return saveErr
		}
		if edited.Body != "edited\n" || edited.Issue != "1" || edited.Parent != nil || edited.UpdatedAt != "2026-09-28T14:00:00.000Z" {
			return fmt.Errorf("edited = %+v", edited)
		}
		return nil
	})
	commentMust(t, err)
	got, err := os.ReadFile(commentPath(directory, "1"))
	commentMust(t, err)
	want := "---\nid: 1\nissue: 1\nparent:\nauthor: Spec Author\ncreatedAt: 2026-09-28T12:00:00.000Z\nupdatedAt: 2026-09-28T14:00:00.000Z\n---\n\nedited\n\n"
	if string(got) != want {
		t.Fatalf("bytes = %q, want %q", got, want)
	}
	if _, err := os.Stat(commentPath(directory, "1") + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("temporary file remains")
	}
}

func TestSaveCommentErrors(t *testing.T) {
	directory := commentTestDirectory(t)
	cases := []struct {
		name  string
		input SaveCommentInput
		want  string
	}{
		{name: "missing issue", input: SaveCommentInput{Body: commentString("x")}, want: "issue is required when creating a comment"},
		{name: "empty issue", input: SaveCommentInput{Issue: commentString(""), Body: commentString("x")}, want: "issue is required when creating a comment"},
		{name: "empty body and missing issue", input: SaveCommentInput{Body: commentString("")}, want: "issue is required when creating a comment"},
		{name: "missing issue file", input: SaveCommentInput{Issue: commentString("9"), Body: commentString("")}, want: "issue not found: 9"},
		{name: "missing parent", input: SaveCommentInput{Parent: commentString("9"), Body: commentString("")}, want: "comment not found: 9"},
		{name: "empty body", input: SaveCommentInput{Issue: commentString("1"), Body: commentString("")}, want: `invalid body: expected a non-empty string, actual ""`},
		{name: "whitespace body", input: SaveCommentInput{Issue: commentString("1"), Body: commentString(" \n\t")}, want: `invalid body: expected a non-empty string, actual " \n\t"`},
		{name: "omitted body", input: SaveCommentInput{Issue: commentString("1")}, want: `invalid body: expected a non-empty string, actual ""`},
		{name: "empty id is create", input: SaveCommentInput{ID: commentString(""), Issue: commentString("9"), Body: commentString("x")}, want: "issue not found: 9"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			err := commentRun(t, func() error {
				_, saveErr := SaveComment(directory, test.input)
				return saveErr
			})
			if err == nil || err.Error() != test.want {
				t.Fatalf("error = %v, want %s", err, test.want)
			}
		})
	}
}

func TestSaveCommentUpdateErrors(t *testing.T) {
	directory := commentTestDirectory(t)
	err := commentRun(t, func() error {
		if _, saveErr := SaveComment(directory, SaveCommentInput{Issue: commentString("1"), Body: commentString("first")}); saveErr != nil {
			return saveErr
		}
		_, saveErr := SaveComment(directory, SaveCommentInput{ID: commentString("1"), Body: commentString("  ")})
		if saveErr == nil || saveErr.Error() != `invalid body: expected a non-empty string, actual "  "` {
			return fmt.Errorf("whitespace = %v", saveErr)
		}
		_, saveErr = SaveComment(directory, SaveCommentInput{ID: commentString("9"), Body: commentString("x")})
		if saveErr == nil || saveErr.Error() != "comment not found: 9" {
			return fmt.Errorf("missing = %v", saveErr)
		}
		return nil
	})
	commentMust(t, err)
}

func TestSaveCommentClockBeforeMissingComment(t *testing.T) {
	directory := commentTestDirectory(t)
	t.Setenv("YARU_NOW", "yesterday")
	err := commentRun(t, func() error {
		_, saveErr := SaveComment(directory, SaveCommentInput{ID: commentString("missing"), Body: commentString("z")})
		return saveErr
	})
	want := `invalid YARU_NOW: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual "yesterday"`
	if err == nil || err.Error() != want {
		t.Fatalf("error = %v", err)
	}
}

func TestListCommentsOrderAndSkip(t *testing.T) {
	directory := commentTestDirectory(t)
	commentMust(t, os.WriteFile(commentPath(directory, "bad"), []byte("hello\n"), 0o666))
	commentMust(t, os.MkdirAll(filepath.Join(directory, "comments", "dir.md"), 0o777))
	commentMust(t, os.WriteFile(filepath.Join(directory, "comments", "ZZ.MD"), []byte("---\nissue: 1\nauthor: Ann\n---\n\nNO\n"), 0o666))
	commentMust(t, os.MkdirAll(filepath.Join(directory, "comments", "nested"), 0o777))
	commentMust(t, os.WriteFile(filepath.Join(directory, "comments", "nested", "9.md"), []byte("---\nissue: 1\nauthor: Ann\ncreatedAt: 2000-01-01T00:00:00.000Z\n---\n\nnested\n"), 0o666))
	commentMust(t, os.WriteFile(commentPath(directory, "10"), []byte("---\nissue: 1\nauthor: Ann\ncreatedAt: 2026-09-28T12:00:00.000Z\nupdatedAt: 2026-09-28T12:00:00.000Z\n---\n\nten\n"), 0o666))
	commentMust(t, os.WriteFile(commentPath(directory, "2"), []byte("---\nissue: 1\nauthor: Ann\ncreatedAt: 2026-09-28T12:00:00.000Z\nupdatedAt: 2026-09-28T12:00:00.000Z\n---\n\ntwo\n"), 0o666))
	commentMust(t, os.WriteFile(commentPath(directory, "notes"), []byte("---\nissue: 1\nauthor: Ann\nparent: none\ncreatedAt:\nupdatedAt: none\n---\n\nkept\n"), 0o666))
	commentMust(t, os.WriteFile(commentPath(directory, "other"), []byte("---\nissue: 2\nauthor: Ann\ncreatedAt: 2000-01-01T00:00:00.000Z\n---\n\nother\n"), 0o666))
	var comments []Comment
	err := commentRun(t, func() error {
		var listErr error
		comments, listErr = ListComments(directory, "1")
		return listErr
	})
	commentMust(t, err)
	got := make([]string, 0, len(comments))
	for _, comment := range comments {
		got = append(got, comment.ID)
	}
	want := []string{"notes", "10", "2"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("ids = %v", got)
	}
	if comments[0].Author != "Ann" || comments[0].Parent != nil || comments[0].CreatedAt != "" || comments[0].UpdatedAt != "none" || comments[0].Body != "kept" {
		t.Fatalf("blank = %+v", comments[0])
	}
}

func TestCommentFormatRoundTrip(t *testing.T) {
	directory := t.TempDir()
	commentMust(t, os.MkdirAll(filepath.Join(directory, "comments"), 0o777))
	original := Comment{
		ID:        "1",
		Issue:     "1",
		Author:    "Spec Author",
		CreatedAt: "2026-09-28T12:05:00.000Z",
		UpdatedAt: "2026-09-28T12:05:00.000Z",
		Body:      "コメント\n次の行",
	}
	text := commentFormat(original)
	want := "---\nid: 1\nissue: 1\nparent:\nauthor: Spec Author\ncreatedAt: 2026-09-28T12:05:00.000Z\nupdatedAt: 2026-09-28T12:05:00.000Z\n---\n\nコメント\n次の行\n"
	if text != want {
		t.Fatalf("bytes = %q, want %q", text, want)
	}
	commentMust(t, os.WriteFile(commentPath(directory, "1"), []byte(text), 0o666))
	got, err := GetComment(directory, "1")
	commentMust(t, err)
	commentEqual(t, got, original)

	parent := "1"
	reply := Comment{
		ID:        "2",
		Issue:     "1",
		Parent:    &parent,
		Author:    "Spec Author",
		CreatedAt: "2026-09-28T12:00:00.000Z",
		UpdatedAt: "2026-09-28T12:00:00.000Z",
		Body:      "  reply  ",
	}
	replyText := commentFormat(reply)
	if !strings.Contains(replyText, "\nparent: 1\n") || !strings.HasSuffix(replyText, "\n\n  reply  \n") {
		t.Fatalf("reply = %q", replyText)
	}
	commentMust(t, os.WriteFile(commentPath(directory, "2"), []byte(replyText), 0o666))
	got, err = GetComment(directory, "2")
	commentMust(t, err)
	commentEqual(t, got, reply)
}

func TestSaveCommentUpdateSeeded(t *testing.T) {
	directory := t.TempDir()
	commentMust(t, os.MkdirAll(filepath.Join(directory, "comments"), 0o777))
	seed := commentFormat(Comment{
		ID:        "1",
		Issue:     "1",
		Author:    "Spec Author",
		CreatedAt: "2026-09-28T12:00:00.000Z",
		UpdatedAt: "2026-09-28T12:00:00.000Z",
		Body:      "first",
	})
	commentMust(t, os.WriteFile(commentPath(directory, "1"), []byte(seed), 0o666))
	t.Setenv("YARU_NOW", "2026-09-28T13:00:00.000Z")
	kept, err := SaveComment(directory, SaveCommentInput{ID: commentString("1")})
	commentMust(t, err)
	commentEqual(t, kept, Comment{
		ID:        "1",
		Issue:     "1",
		Author:    "Spec Author",
		CreatedAt: "2026-09-28T12:00:00.000Z",
		UpdatedAt: "2026-09-28T13:00:00.000Z",
		Body:      "first",
	})
	t.Setenv("YARU_NOW", "2026-09-28T14:00:00.000Z")
	edited, err := SaveComment(directory, SaveCommentInput{
		ID:     commentString("1"),
		Issue:  commentString("9"),
		Parent: commentString("9"),
		Body:   commentString("edited\n"),
	})
	commentMust(t, err)
	commentEqual(t, edited, Comment{
		ID:        "1",
		Issue:     "1",
		Author:    "Spec Author",
		CreatedAt: "2026-09-28T12:00:00.000Z",
		UpdatedAt: "2026-09-28T14:00:00.000Z",
		Body:      "edited\n",
	})
	got, err := os.ReadFile(commentPath(directory, "1"))
	commentMust(t, err)
	want := "---\nid: 1\nissue: 1\nparent:\nauthor: Spec Author\ncreatedAt: 2026-09-28T12:00:00.000Z\nupdatedAt: 2026-09-28T14:00:00.000Z\n---\n\nedited\n\n"
	if string(got) != want {
		t.Fatalf("bytes = %q, want %q", got, want)
	}
	if _, statErr := os.Stat(commentPath(directory, "1") + ".tmp"); !os.IsNotExist(statErr) {
		t.Fatal("temporary file remains")
	}
}

func TestGetCommentDoesNotUseClockOrRewriteAuthor(t *testing.T) {
	directory := commentTestDirectory(t)
	text := "---\nissue: 1\nparent: none\nauthor:\ncreatedAt:\nupdatedAt: none\n---\n\nkept\n"
	commentMust(t, os.WriteFile(commentPath(directory, "blank"), []byte(text), 0o666))
	t.Setenv("YARU_NOW", "yesterday")
	var got Comment
	err := commentRun(t, func() error {
		var readErr error
		got, readErr = GetComment(directory, "blank")
		return readErr
	})
	commentMust(t, err)
	if got.Author != "Spec Author" || got.Parent != nil || got.UpdatedAt != "none" || got.Body != "kept" || got.ID != "blank" {
		t.Fatalf("comment = %+v", got)
	}
	file, err := os.ReadFile(commentPath(directory, "blank"))
	commentMust(t, err)
	if string(file) != text {
		t.Fatalf("file changed: %q", file)
	}
}

func TestSaveCommentFillsEmptyAuthor(t *testing.T) {
	directory := commentTestDirectory(t)
	text := "---\nissue: 1\nparent: none\nauthor:\ncreatedAt:\nupdatedAt: none\nextra: z\n---\n\nkept\n"
	commentMust(t, os.WriteFile(commentPath(directory, "blank"), []byte(text), 0o666))
	t.Setenv("YARU_NOW", "2026-09-28T15:00:00.000Z")
	err := commentRun(t, func() error {
		updated, saveErr := SaveComment(directory, SaveCommentInput{ID: commentString("blank")})
		if saveErr != nil {
			return saveErr
		}
		if updated.Author != "Spec Author" || updated.Body != "kept" || updated.CreatedAt != "" || updated.UpdatedAt != "2026-09-28T15:00:00.000Z" {
			return fmt.Errorf("updated = %+v", updated)
		}
		return nil
	})
	commentMust(t, err)
	got, err := os.ReadFile(commentPath(directory, "blank"))
	commentMust(t, err)
	want := "---\nid: blank\nissue: 1\nparent:\nauthor: Spec Author\ncreatedAt:\nupdatedAt: 2026-09-28T15:00:00.000Z\n---\n\nkept\n"
	if string(got) != want {
		t.Fatalf("bytes = %q, want %q", got, want)
	}
}

func TestCommentInvalidFiles(t *testing.T) {
	directory := commentTestDirectory(t)
	commentMust(t, os.WriteFile(commentPath(directory, "bad"), []byte("hello\n"), 0o666))
	commentMust(t, os.WriteFile(commentPath(directory, "nokey"), []byte("---\nid: nokey\nauthor: A\n---\n\nbody\n"), 0o666))
	commentMust(t, os.WriteFile(commentPath(directory, "emptyissue"), []byte("---\nissue:\nauthor: A\n---\n\nbody\n"), 0o666))
	commentMust(t, os.WriteFile(commentPath(directory, "issuenone"), []byte("---\nissue: none\nauthor: A\ncreatedAt: 2020-01-01T00:00:00.000Z\n---\n\nbody\n"), 0o666))
	commentMust(t, os.WriteFile(commentPath(directory, "01"), []byte("---\nid: 99\nissue: 1\nauthor: Ann\ncreatedAt: 2019-01-01T00:00:00.000Z\nupdatedAt: 2019-01-01T00:00:00.000Z\n---\n\nold\n"), 0o666))
	commentMust(t, os.WriteFile(commentPath(directory, "closer"), []byte("---\nissue: 1\nauthor: Ann\ncreatedAt: 2026-01-03T00:00:00.000Z\n---\n\nbefore\n---\nafter\n"), 0o666))
	err := commentRun(t, func() error {
		_, readErr := GetComment(directory, "bad")
		if readErr == nil || readErr.Error() != "invalid issue file" {
			return fmt.Errorf("bad = %v", readErr)
		}
		_, readErr = GetComment(directory, "nokey")
		if readErr == nil || readErr.Error() != "invalid comment file" {
			return fmt.Errorf("nokey = %v", readErr)
		}
		_, readErr = GetComment(directory, "emptyissue")
		if readErr == nil || readErr.Error() != "invalid comment file" {
			return fmt.Errorf("empty = %v", readErr)
		}
		got, readErr := GetComment(directory, "issuenone")
		if readErr != nil {
			return readErr
		}
		if got.Issue != "none" || got.ID != "issuenone" || got.Body != "body" || got.UpdatedAt != "" {
			return fmt.Errorf("none = %+v", got)
		}
		got, readErr = GetComment(directory, "01")
		if readErr != nil {
			return readErr
		}
		if got.ID != "01" || got.Body != "old" {
			return fmt.Errorf("stem = %+v", got)
		}
		got, readErr = GetComment(directory, "closer")
		if readErr != nil {
			return readErr
		}
		if got.Body != "before\n---\nafter" {
			return fmt.Errorf("body = %q", got.Body)
		}
		return nil
	})
	commentMust(t, err)
}

func TestListCommentsRequiresReadableIssue(t *testing.T) {
	directory := commentTestDirectory(t)
	t.Setenv("YARU_NOW", "yesterday")
	err := commentRun(t, func() error {
		_, listErr := ListComments(directory, "1")
		return listErr
	})
	want := `invalid YARU_NOW: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual "yesterday"`
	if err == nil || err.Error() != want {
		t.Fatalf("clock = %v", err)
	}
	t.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	commentMust(t, os.WriteFile(filepath.Join(directory, "config.yml"), []byte("staleAfter: nope\n"), 0o666))
	err = commentRun(t, func() error {
		_, listErr := ListComments(directory, "9")
		return listErr
	})
	if err == nil || err.Error() != `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual "nope"` {
		t.Fatalf("stale = %v", err)
	}
	commentMust(t, os.WriteFile(filepath.Join(directory, "config.yml"), nil, 0o666))
	commentTestWriteIssue(t, directory, "1", "nope", "", "")
	err = commentRun(t, func() error {
		_, saveErr := SaveComment(directory, SaveCommentInput{Issue: commentString("1"), Body: commentString("")})
		return saveErr
	})
	if err == nil || err.Error() != "invalid status: expected backlog, todo, in_progress, done, or canceled, actual nope" {
		t.Fatalf("status = %v", err)
	}
	commentTestWriteIssue(t, directory, "1", "todo", "2026-02-30", "")
	err = commentRun(t, func() error {
		_, listErr := ListComments(directory, "1")
		return listErr
	})
	if err == nil || err.Error() != "invalid dueDate: expected YYYY-MM-DD, actual 2026-02-30" {
		t.Fatalf("due = %v", err)
	}
	commentTestWriteIssue(t, directory, "1", "todo", "0001-01-01", "")
	err = commentRun(t, func() error {
		_, listErr := ListComments(directory, "1")
		return listErr
	})
	if err == nil || err.Error() != "invalid dueDate: expected YYYY-MM-DD, actual 0001-01-01" {
		t.Fatalf("year = %v", err)
	}
	commentTestWriteIssue(t, directory, "1", "todo", "0100-01-01", "NOW")
	err = commentRun(t, func() error {
		_, listErr := ListComments(directory, "1")
		return listErr
	})
	if err == nil || err.Error() != "invalid priority: expected urgent, high, medium, or low, actual NOW" {
		t.Fatalf("priority = %v", err)
	}
	commentTestWriteIssue(t, directory, "1", "todo", "none", "none")
	err = commentRun(t, func() error {
		comments, listErr := ListComments(directory, "1")
		if listErr != nil {
			return listErr
		}
		if len(comments) != 0 {
			return fmt.Errorf("len = %d", len(comments))
		}
		return nil
	})
	commentMust(t, err)
}

func TestSaveCommentUpdateIgnoresStaleAfter(t *testing.T) {
	directory := commentTestDirectory(t)
	err := commentRun(t, func() error {
		if _, saveErr := SaveComment(directory, SaveCommentInput{Issue: commentString("1"), Body: commentString("first")}); saveErr != nil {
			return saveErr
		}
		commentMust(t, os.WriteFile(filepath.Join(directory, "config.yml"), []byte("staleAfter: 0h\n"), 0o666))
		t.Setenv("YARU_NOW", "2026-09-28T17:00:00.000Z")
		updated, saveErr := SaveComment(directory, SaveCommentInput{ID: commentString("1"), Body: commentString("still")})
		if saveErr != nil {
			return saveErr
		}
		if updated.Body != "still" || updated.UpdatedAt != "2026-09-28T17:00:00.000Z" {
			return fmt.Errorf("updated = %+v", updated)
		}
		_, saveErr = SaveComment(directory, SaveCommentInput{Issue: commentString("1"), Body: commentString("nope")})
		if saveErr == nil || saveErr.Error() != `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual "0h"` {
			return fmt.Errorf("create = %v", saveErr)
		}
		return nil
	})
	commentMust(t, err)
}

func TestSaveCommentKeepsAnswerMarker(t *testing.T) {
	directory := commentTestDirectory(t)
	body := "before\n<!-- yaru:answer -->\nafter"
	err := commentRun(t, func() error {
		saved, saveErr := SaveComment(directory, SaveCommentInput{Issue: commentString("1"), Body: &body})
		if saveErr != nil {
			return saveErr
		}
		if saved.Body != body {
			return fmt.Errorf("body = %q", saved.Body)
		}
		return nil
	})
	commentMust(t, err)
}
