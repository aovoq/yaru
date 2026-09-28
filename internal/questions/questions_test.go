package questions

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/workspace"
)

// テスト中の時刻・JSON・frontmatter は、仕様どおりの代わりに差し替える。
// 既定の変数は土台の関数のままにしておき、土台の中身が入ったらそのまま使えるようにする。
// docs/spec/yaru-format.md の「共通の frontmatter」「JSON の escape」「question」
var (
	originalFormatDocument    = formatDocument
	originalParseDocument     = parseDocument
	originalMarshalJavaScript = marshalJavaScript
	originalCurrentTime       = currentTime
	originalISOString         = isoString
	originalWorkingDirectory  = workingDirectory
	originalGitName           = gitName
)

func init() {
	location, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		panic(err)
	}
	time.Local = location
	// document と clock は取り込み済みなので、テストもその関数を通す。
	// workspace はまだ panic なので、作業ディレクトリと git の名前だけ差し替える。
	workingDirectory = func() (string, error) { return "/physical/work", nil }
	gitName = func(directory string) string {
		lastGitDirectory = directory
		return "Spec Author"
	}
}

var lastGitDirectory string

func TestDefaultsCallFoundation(t *testing.T) {
	if reflect.ValueOf(originalFormatDocument).Pointer() != reflect.ValueOf(document.Format).Pointer() {
		t.Fatal("formatDocument must default to document.Format")
	}
	if reflect.ValueOf(originalParseDocument).Pointer() != reflect.ValueOf(document.Parse).Pointer() {
		t.Fatal("parseDocument must default to document.Parse")
	}
	if reflect.ValueOf(originalMarshalJavaScript).Pointer() != reflect.ValueOf(document.MarshalJavaScript).Pointer() {
		t.Fatal("marshalJavaScript must default to document.MarshalJavaScript")
	}
	if reflect.ValueOf(originalCurrentTime).Pointer() != reflect.ValueOf(clock.Now).Pointer() {
		t.Fatal("currentTime must default to clock.Now")
	}
	if reflect.ValueOf(originalISOString).Pointer() != reflect.ValueOf(clock.ISOString).Pointer() {
		t.Fatal("isoString must default to clock.ISOString")
	}
	if reflect.ValueOf(originalWorkingDirectory).Pointer() != reflect.ValueOf(workspace.WorkingDirectory).Pointer() {
		t.Fatal("workingDirectory must default to workspace.WorkingDirectory")
	}
	if reflect.ValueOf(originalGitName).Pointer() != reflect.ValueOf(workspace.GitName).Pointer() {
		t.Fatal("gitName must default to workspace.GitName")
	}
}

func TestFoundationRoundTripWhenImplemented(t *testing.T) {
	defer func() {
		if recovered := recover(); recovered != nil {
			t.Skipf("foundation is not implemented yet: %v", recovered)
		}
	}()
	encoded, err := document.MarshalJavaScript([]string{"<", ">", "&", "\"", "\\", "\u2028"})
	if err != nil {
		t.Fatal(err)
	}
	want := []byte(`["<",">","&","\"","\\","` + "\u2028" + `"]`)
	if string(encoded) != string(want) {
		t.Fatalf("marshal\n got: %q\nwant: %q", encoded, want)
	}
	formatted := document.Format([]document.Field{{Key: "id", Value: "1"}, {Key: "title", Value: ""}}, "body")
	if formatted != "---\nid: 1\ntitle:\n---\n\nbody\n" {
		t.Fatalf("format: %q", formatted)
	}
	if clock.ISOString(time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)) != "2026-09-28T12:00:00.000Z" {
		t.Fatal("ISOString")
	}
}

var fixedNow = time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)

func TestCreateStoresMarkdownAndReadsOpen(t *testing.T) {
	directory := newDirectory(t)
	records := issueOne()
	created := mustSave(t, directory, records, SaveInput{
		Title:         str("本番 DB の称号を消すか"),
		Issue:         str("1"),
		Priority:      str("high"),
		DefaultAction: str("消さずに残す"),
		AnswerBy:      str("2h"),
		Body:          str("背景の説明"),
	}, fixedNow)
	if created.ID != "1" || created.Status != "open" || created.Answer != nil {
		t.Fatalf("created: %#v", created)
	}
	if created.AnswerBy == nil || *created.AnswerBy != "2026-09-25T11:00:00.000Z" {
		t.Fatalf("answerBy: %#v", created.AnswerBy)
	}
	if created.Author != "Spec Author" {
		t.Fatalf("author: %s", created.Author)
	}
	if lastGitDirectory != "/physical/work" {
		t.Fatalf("git directory: %s", lastGitDirectory)
	}
	text := readText(t, filepath.Join(directory.Dir, "questions", "1.md"))
	if !strings.Contains(text, "title: 本番 DB の称号を消すか\n") || !strings.Contains(text, "defaultAction: 消さずに残す\n") {
		t.Fatalf("file:\n%s", text)
	}
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimRight(line, " \t") != line && strings.HasSuffix(line, " ") {
			t.Fatalf("trailing space: %q", line)
		}
	}
	got := mustGet(t, directory, "1", fixedNow)
	if !reflect.DeepEqual(got, created) {
		t.Fatalf("read\n got: %#v\nwant: %#v", got, created)
	}
	if len(records.issues) != 1 || records.issues[0] != "1" {
		t.Fatalf("getIssue calls: %#v", records.issues)
	}
}

func TestAnsweredFileMatchesSpecBytes(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, issueOne(), SaveInput{
		Title:         str("本番 DB の称号を消すか"),
		Issue:         str("1"),
		Priority:      str("high"),
		DefaultAction: str("消さずに残す"),
		AnswerBy:      str("2026-09-25T11:00:00.000Z"),
		Options:       strs("残す", "消す, ただし \"本番\" だけ", "a\\b"),
		Provenance: &Provenance{
			Session:  str("session-1"),
			Worktree: str("/work/feature"),
			Branch:   str("feat/add-thing"),
		},
		Body: str("背景の説明\n続き"),
	}, fixedNow)
	answeredAt := time.Date(2026, 9, 25, 9, 5, 0, 0, time.UTC)
	mustAnswer(t, directory, issueOne(), "1", AnswerInput{Body: str("残す\n\n理由は後で")}, answeredAt)
	acknowledgedAt := time.Date(2026, 9, 25, 9, 6, 0, 0, time.UTC)
	acknowledged := mustAcknowledge(t, directory, "1", acknowledgedAt)
	if acknowledged.UpdatedAt != answeredAt.UTC().Format("2006-01-02T15:04:05.000Z") {
		t.Fatalf("updatedAt changed on acknowledge: %s", acknowledged.UpdatedAt)
	}
	text := readText(t, filepath.Join(directory.Dir, "questions", "1.md"))
	const want = "" +
		"---\n" +
		"id: 1\n" +
		"title: 本番 DB の称号を消すか\n" +
		"status: open\n" +
		"issue: 1\n" +
		"priority: high\n" +
		"defaultAction: 消さずに残す\n" +
		"answerBy: 2026-09-25T11:00:00.000Z\n" +
		"options: [\"残す\",\"消す, ただし \\\"本番\\\" だけ\",\"a\\\\b\"]\n" +
		"author: Spec Author\n" +
		"session: session-1\n" +
		"worktree: /work/feature\n" +
		"branch: feat/add-thing\n" +
		"answeredBy: Spec Author\n" +
		"answeredAt: 2026-09-25T09:05:00.000Z\n" +
		"acknowledgedAt: 2026-09-25T09:06:00.000Z\n" +
		"notifiedExpiringAt:\n" +
		"canceledAt:\n" +
		"createdAt: 2026-09-25T09:00:00.000Z\n" +
		"updatedAt: 2026-09-25T09:05:00.000Z\n" +
		"---\n" +
		"\n" +
		"背景の説明\n" +
		"続き\n" +
		"\n" +
		"<!-- yaru:answer -->\n" +
		"\n" +
		"残す\n" +
		"\n" +
		"理由は後で\n"
	if text != want {
		t.Fatalf("file\n got:\n%s\nwant:\n%s", text, want)
	}
}

func TestEmptyBodyAnswerFile(t *testing.T) {
	directory := newDirectory(t)
	created := mustSave(t, directory, nil, SaveInput{Title: str("empty body"), Body: str("")}, fixedNow)
	mustAnswer(t, directory, nil, created.ID, AnswerInput{Body: str("yes")}, fixedNow)
	text := readText(t, filepath.Join(directory.Dir, "questions", created.ID+".md"))
	const want = "" +
		"---\n" +
		"id: 1\n" +
		"title: empty body\n" +
		"status: open\n" +
		"issue:\n" +
		"priority:\n" +
		"defaultAction:\n" +
		"answerBy:\n" +
		"options:\n" +
		"author: Spec Author\n" +
		"session:\n" +
		"worktree:\n" +
		"branch:\n" +
		"answeredBy: Spec Author\n" +
		"answeredAt: 2026-09-25T09:00:00.000Z\n" +
		"acknowledgedAt:\n" +
		"notifiedExpiringAt:\n" +
		"canceledAt:\n" +
		"createdAt: 2026-09-25T09:00:00.000Z\n" +
		"updatedAt: 2026-09-25T09:00:00.000Z\n" +
		"---\n" +
		"\n" +
		"<!-- yaru:answer -->\n" +
		"\n" +
		"yes\n"
	if text != want {
		t.Fatalf("file\n got:\n%s\nwant:\n%s", text, want)
	}
}

func TestResolveAnswerBy(t *testing.T) {
	cases := []struct {
		value string
		want  string
		null  bool
		error string
	}{
		{value: "30m", want: "2026-09-25T09:30:00.000Z"},
		{value: "2h", want: "2026-09-25T11:00:00.000Z"},
		{value: "0h", want: "2026-09-25T09:00:00.000Z"},
		{value: "00h", want: "2026-09-25T09:00:00.000Z"},
		{value: "0001m", want: "2026-09-25T09:01:00.000Z"},
		{value: "1d", want: "2026-09-26T09:00:00.000Z"},
		{value: "2026-09-30T18:00:00+09:00", want: "2026-09-30T09:00:00.000Z"},
		{value: "2026-09-30T09:00:00.5Z", want: "2026-09-30T09:00:00.500Z"},
		{value: "2026-09-30T09:00:00.50Z", want: "2026-09-30T09:00:00.500Z"},
		{value: "2026-09-30T09:00:00.5004Z", want: "2026-09-30T09:00:00.500Z"},
		{value: "2026-09-30T09:00:00.5005Z", want: "2026-09-30T09:00:00.500Z"},
		{value: "2026-09-30T09:00:00.123456Z", want: "2026-09-30T09:00:00.123Z"},
		{value: "2026-09-30T09:00Z", want: "2026-09-30T09:00:00.000Z"},
		{value: "2026-02-30T12:00:00Z", want: "2026-03-02T12:00:00.000Z"},
		{value: "2026-09-30T24:00:00Z", want: "2026-10-01T00:00:00.000Z"},
		{value: "2026-09-31T24:00:00Z", want: "2026-10-02T00:00:00.000Z"},
		{value: "2026-02-29T24:00:00Z", want: "2026-03-02T00:00:00.000Z"},
		{value: "2024-02-29T24:00:00Z", want: "2024-03-01T00:00:00.000Z"},
		{value: "2026-09-30T24:00:00+09:00", want: "2026-09-30T15:00:00.000Z"},
		{value: "2026-09-30T09:00:00.000+09:00", want: "2026-09-30T00:00:00.000Z"},
		{value: "2026-09-30T09:00:00-09:30", want: "2026-09-30T18:30:00.000Z"},
		{value: "0100-01-01T00:00:00Z", want: "0100-01-01T00:00:00.000Z"},
		{value: "0001-01-01T00:00:00.000Z", want: "0001-01-01T00:00:00.000Z"},
		{value: "0000-01-01T00:00:00.000Z", want: "0000-01-01T00:00:00.000Z"},
		{value: " 2h ", want: "2026-09-25T11:00:00.000Z"},
		{value: "none", null: true},
		{value: "", null: true},
		{value: "tomorrow", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual tomorrow"},
		{value: "2026-09-30", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2026-09-30"},
		{value: "2026-09-30t09:00:00Z", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2026-09-30t09:00:00Z"},
		{value: "2026-09-30T09:00:00z", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2026-09-30T09:00:00z"},
		{value: "2H", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2H"},
		{value: "1.5h", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 1.5h"},
		{value: "2026-13-01T00:00:00Z", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2026-13-01T00:00:00Z"},
		{value: "2026-09-30T24:00:01Z", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2026-09-30T24:00:01Z"},
		{value: "2026-00-10T00:00:00Z", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2026-00-10T00:00:00Z"},
		{value: "2026-09-00T00:00:00Z", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2026-09-00T00:00:00Z"},
		{value: "2026-09-30T23:60:00Z", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2026-09-30T23:60:00Z"},
		{value: "2026-09-30T23:59:60Z", error: "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual 2026-09-30T23:59:60Z"},
	}
	for _, testCase := range cases {
		resolved, provided, err := ResolveAnswerBy(str(testCase.value), fixedNow)
		if testCase.error != "" {
			requireError(t, err, testCase.error)
			continue
		}
		if err != nil || !provided {
			t.Fatalf("%q: %#v %v", testCase.value, resolved, err)
		}
		if testCase.null {
			if resolved != nil {
				t.Fatalf("%q: got %#v", testCase.value, resolved)
			}
			continue
		}
		if resolved == nil || *resolved != testCase.want {
			t.Fatalf("%q: got %#v want %s", testCase.value, resolved, testCase.want)
		}
	}
	if _, provided, err := ResolveAnswerBy(nil, fixedNow); provided || err != nil {
		t.Fatalf("nil: provided %v err %v", provided, err)
	}
}

func TestOpenQuestionPastAnswerByReadsExpired(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("q"), AnswerBy: str("1h"), DefaultAction: str("進める")}, fixedNow)
	later := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
	if mustGet(t, directory, "1", later).Status != "expired" {
		t.Fatal("status")
	}
	if ids(mustList(t, directory, QuestionFilter{Status: str("expired")}, later)) != "1" {
		t.Fatal("expired filter")
	}
	if len(mustList(t, directory, QuestionFilter{Status: str("open")}, later)) != 0 {
		t.Fatal("open filter")
	}
}

func TestAnswerRoundTripAndStaysAnswered(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("q"), Body: str("context")}, fixedNow)
	answeredAt := time.Date(2026, 9, 25, 9, 5, 0, 0, time.UTC)
	answered := mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("残す\n\n理由は後で")}, answeredAt)
	if answered.Status != "answered" || answered.Body != "context" || answered.Answer == nil || *answered.Answer != "残す\n\n理由は後で" {
		t.Fatalf("%#v", answered)
	}
	if !reflect.DeepEqual(mustGet(t, directory, "1", answeredAt), answered) {
		t.Fatal("read")
	}
	mustSave(t, directory, nil, SaveInput{Title: str("deadline"), AnswerBy: str("1h")}, fixedNow)
	mustAnswer(t, directory, nil, "2", AnswerInput{Body: str("yes")}, fixedNow)
	if mustGet(t, directory, "2", time.Date(2026, 9, 26, 0, 0, 0, 0, time.UTC)).Status != "answered" {
		t.Fatal("stayed answered")
	}
}

func TestAnswerKeepsTrailingNewlineAndSpaces(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("q")}, fixedNow)
	answered := mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("yes\n")}, fixedNow)
	if answered.Answer == nil || *answered.Answer != "yes\n" {
		t.Fatalf("%#v", answered.Answer)
	}
	spaced := mustAnswer(t, directory, nil, "1", AnswerInput{Body: str(" yes "), Force: true}, fixedNow)
	if spaced.Answer == nil || *spaced.Answer != " yes " {
		t.Fatalf("%#v", spaced.Answer)
	}
}

func TestLateAnswerAndComment(t *testing.T) {
	directory := newDirectory(t)
	records := issueOne()
	mustSave(t, directory, records, SaveInput{Title: str("消すか"), Issue: str("1"), DefaultAction: str("残す"), AnswerBy: str("1h")}, fixedNow)
	mustSave(t, directory, records, SaveInput{Title: str("in time"), Issue: str("1"), AnswerBy: str("1h")}, fixedNow)
	later := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	if mustAnswer(t, directory, records, "1", AnswerInput{Body: str("消してよい\n\n理由は後で")}, later).Status != "answered" {
		t.Fatal("late")
	}
	mustAnswer(t, directory, records, "2", AnswerInput{Body: str("on time")}, fixedNow)
	mustAnswer(t, directory, records, "1", AnswerInput{Body: str("やはり残す"), Force: true}, later)
	if len(records.comments) != 1 || records.comments[0] != "Late answer to Q1 (消すか), after the agent proceeded with the default:\n\n消してよい\n\n理由は後で" {
		t.Fatalf("comments: %#v", records.comments)
	}
	plain := issueOne()
	mustSave(t, directory, plain, SaveInput{Title: str("どうするか"), Issue: str("1"), AnswerBy: str("1h")}, fixedNow)
	mustAnswer(t, directory, plain, "3", AnswerInput{Body: str("こうする")}, later)
	if len(plain.comments) != 1 || plain.comments[0] != "Late answer to Q3 (どうするか), after answerBy passed:\n\nこうする" {
		t.Fatalf("plain: %#v", plain.comments)
	}
}

func TestSaveCommentErrorLeavesTheAnswer(t *testing.T) {
	directory := newDirectory(t)
	records := issueOne()
	records.commentErr = errors.New("issue not found: 1")
	mustSave(t, directory, records, SaveInput{Title: str("q"), Issue: str("1"), AnswerBy: str("1h")}, fixedNow)
	later := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	_, err := AnswerQuestion(directory, records, "1", AnswerInput{Body: str("yes")}, &later)
	requireError(t, err, "issue not found: 1")
	if mustGet(t, directory, "1", later).Status != "answered" {
		t.Fatal("answer was rolled back")
	}
}

func TestCancelReopenAndConflict(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("q")}, fixedNow)
	canceled := mustSave(t, directory, nil, SaveInput{ID: str("1"), Status: str("canceled")}, fixedNow)
	if canceled.Status != "canceled" || canceled.CanceledAt == nil || *canceled.CanceledAt != "2026-09-25T09:00:00.000Z" {
		t.Fatalf("%#v", canceled)
	}
	_, err := AnswerQuestion(directory, nil, "1", AnswerInput{Body: str("yes"), Force: true}, &fixedNow)
	var conflict *QuestionConflictError
	if !errors.As(err, &conflict) || conflict.Error() != "cannot answer question 1: expected status open or expired, actual canceled" {
		t.Fatalf("%v", err)
	}
	reopened := mustSave(t, directory, nil, SaveInput{ID: str("1"), Status: str("open")}, fixedNow)
	if reopened.Status != "open" || reopened.CanceledAt != nil {
		t.Fatalf("%#v", reopened)
	}
	created := mustSave(t, directory, nil, SaveInput{Title: str("born canceled"), Status: str("canceled")}, fixedNow)
	if created.Status != "canceled" {
		t.Fatal(created.Status)
	}
}

func TestUpdateChangesOnlyGivenFields(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, issueOne(), SaveInput{Title: str("q"), Issue: str("1"), Priority: str("low"), DefaultAction: str("x"), AnswerBy: str("1h")}, fixedNow)
	records := &fakeIssues{}
	updated := mustSave(t, directory, records, SaveInput{ID: str("1"), Priority: str("urgent"), DefaultAction: str("none"), AnswerBy: str("none")}, fixedNow)
	if updated.Title != "q" || updated.Issue == nil || *updated.Issue != "1" || updated.Priority == nil || *updated.Priority != "urgent" || updated.DefaultAction != nil || updated.AnswerBy != nil {
		t.Fatalf("%#v", updated)
	}
	if len(records.issues) != 0 {
		t.Fatalf("cleared fields still checked the issue: %#v", records.issues)
	}
}

func TestListFilterAndOrder(t *testing.T) {
	directory := newDirectory(t)
	records := issueOne()
	mustSave(t, directory, records, SaveInput{Title: str("first"), Issue: str("1")}, fixedNow)
	mustSave(t, directory, records, SaveInput{Title: str("second")}, time.Date(2026, 9, 25, 9, 1, 0, 0, time.UTC))
	mustSave(t, directory, records, SaveInput{Title: str("third"), Issue: str("1")}, time.Date(2026, 9, 25, 9, 2, 0, 0, time.UTC))
	mustAnswer(t, directory, records, "3", AnswerInput{Body: str("done")}, fixedNow)
	if ids(mustList(t, directory, QuestionFilter{}, fixedNow)) != "1,2,3" {
		t.Fatal(ids(mustList(t, directory, QuestionFilter{}, fixedNow)))
	}
	if ids(mustList(t, directory, QuestionFilter{Issue: "1"}, fixedNow)) != "1,3" {
		t.Fatal("issue")
	}
	if ids(mustList(t, directory, QuestionFilter{Status: str("answered")}, fixedNow)) != "3" {
		t.Fatal("status")
	}
	_, err := ListQuestions(directory, QuestionFilter{Status: str("pending")}, &fixedNow)
	requireError(t, err, "invalid status: expected open, expired, answered, or canceled, actual pending")
}

func TestAwaitingOrder(t *testing.T) {
	directory := newDirectory(t)
	at := func(minutes int) time.Time { return fixedNow.Add(time.Duration(minutes) * time.Minute) }
	mustSave(t, directory, nil, SaveInput{Title: str("blocking old")}, at(0))
	mustSave(t, directory, nil, SaveInput{Title: str("due later"), DefaultAction: str("x"), AnswerBy: str("3h")}, at(1))
	mustSave(t, directory, nil, SaveInput{Title: str("due soon"), DefaultAction: str("x"), AnswerBy: str("1h")}, at(2))
	mustSave(t, directory, nil, SaveInput{Title: str("no deadline"), DefaultAction: str("x")}, at(3))
	mustSave(t, directory, nil, SaveInput{Title: str("proceeded"), DefaultAction: str("x"), AnswerBy: str("10m")}, at(4))
	mustSave(t, directory, nil, SaveInput{Title: str("blocking new")}, at(5))
	now := at(30)
	if ids(mustList(t, directory, QuestionFilter{}, now)) != "1,6,3,2,4,5" {
		t.Fatal(ids(mustList(t, directory, QuestionFilter{}, now)))
	}
	groups := GroupAwaitingQuestions(mustList(t, directory, QuestionFilter{}, now), func(question Question) Question { return question })
	if ids(groups.Blocking) != "1,6" || ids(groups.DueSoon) != "3,2" || ids(groups.NoDeadline) != "4" || ids(groups.Proceeded) != "5" {
		t.Fatalf("%#v", groups)
	}
}

func TestGroupingKeepsWrapper(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("blocking")}, fixedNow)
	mustSave(t, directory, nil, SaveInput{Title: str("timed"), DefaultAction: str("x"), AnswerBy: str("1h")}, fixedNow)
	mustAnswer(t, directory, nil, "2", AnswerInput{Body: str("done")}, fixedNow)
	type item struct {
		Workspace string
		Question  Question
	}
	questions := mustList(t, directory, QuestionFilter{}, fixedNow)
	items := []item{{Workspace: "a", Question: questions[0]}, {Workspace: "a", Question: questions[1]}}
	groups := GroupAwaitingQuestions(items, func(value item) Question { return value.Question })
	if len(groups.Blocking) != 1 || groups.Blocking[0].Question.ID != "1" || len(groups.DueSoon) != 0 || len(groups.Proceeded) != 0 {
		t.Fatalf("%#v", groups)
	}
}

func TestProvenanceIsCreateOnly(t *testing.T) {
	directory := newDirectory(t)
	provenance := &Provenance{Session: str("session-1"), Worktree: str("/work/linked"), Branch: str("feat/add-thing")}
	created := mustSave(t, directory, nil, SaveInput{Title: str("q"), Provenance: provenance}, fixedNow)
	if created.Session == nil || *created.Session != "session-1" || created.Worktree == nil || *created.Worktree != "/work/linked" {
		t.Fatalf("%#v", created)
	}
	updated := mustSave(t, directory, nil, SaveInput{ID: str("1"), Priority: str("high"), Provenance: &Provenance{Session: str("other")}}, fixedNow)
	if updated.Session == nil || *updated.Session != "session-1" {
		t.Fatalf("%#v", updated.Session)
	}
	without := mustSave(t, directory, nil, SaveInput{Title: str("without")}, fixedNow)
	if without.Session != nil || without.Worktree != nil || without.Branch != nil {
		t.Fatalf("%#v", without)
	}
}

func TestOptions(t *testing.T) {
	directory := newDirectory(t)
	created := mustSave(t, directory, nil, SaveInput{Title: str("q"), Options: strs("残す", "消す, ただし本番だけ", " 後で決める ")}, fixedNow)
	if strings.Join(created.Options, "|") != "残す|消す, ただし本番だけ|後で決める" {
		t.Fatal(created.Options)
	}
	if strings.Join(mustGet(t, directory, "1", fixedNow).Options, "|") != strings.Join(created.Options, "|") {
		t.Fatal("read")
	}
	if strings.Join(mustSave(t, directory, nil, SaveInput{ID: str("1"), Options: strs("a")}, fixedNow).Options, "|") != "a" {
		t.Fatal("replace")
	}
	if strings.Join(mustSave(t, directory, nil, SaveInput{ID: str("1"), Priority: str("low")}, fixedNow).Options, "|") != "a" {
		t.Fatal("kept")
	}
	if len(mustSave(t, directory, nil, SaveInput{ID: str("1"), Options: strs()}, fixedNow).Options) != 0 {
		t.Fatal("clear")
	}
	if len(mustSave(t, directory, nil, SaveInput{Title: str("none")}, fixedNow).Options) != 0 {
		t.Fatal("default")
	}
	_, err := SaveQuestion(directory, nil, SaveInput{Title: str("blank"), Options: strs("a", " ")}, &fixedNow)
	requireError(t, err, `invalid option: expected a non-empty string, actual " "`)
	_, err = SaveQuestion(directory, nil, SaveInput{Title: str("twice"), Options: strs("a", "a")}, &fixedNow)
	requireError(t, err, `invalid option: expected each option once, actual "a" twice`)
	_, err = SaveQuestion(directory, nil, SaveInput{Title: str("collapsed"), Options: strs("a b", "a\nb")}, &fixedNow)
	requireError(t, err, `invalid option: expected each option once, actual "a b" twice`)
	_, err = SaveQuestion(directory, nil, SaveInput{Title: str("line"), Options: strs("\u2028")}, &fixedNow)
	requireError(t, err, "invalid option: expected a non-empty string, actual \""+"\u2028"+"\"")
	special := mustSave(t, directory, nil, SaveInput{Title: str("special"), Options: strs("<", ">", "&", "\u0000", "\b\f\n\r\t", "a\u2028b", "あ", "\"", "\\")}, fixedNow)
	text := readText(t, filepath.Join(directory.Dir, "questions", special.ID+".md"))
	if !strings.Contains(text, `options: ["<",">","&","\u0000","\b","a`+"\u2028"+`b","あ","\"","\\"]`+"\n") {
		t.Fatalf("options line missing in\n%s", text)
	}
	if !reflect.DeepEqual(mustGet(t, directory, special.ID, fixedNow).Options, special.Options) {
		t.Fatal("round trip")
	}
}

func TestDuplicateUnlessForced(t *testing.T) {
	directory := newDirectory(t)
	records := issueOne()
	mustSave(t, directory, records, SaveInput{Title: str("消すか"), Issue: str("1")}, fixedNow)
	_, err := SaveQuestion(directory, records, SaveInput{Title: str(" 消すか "), Issue: str("1")}, &fixedNow)
	requireError(t, err, `duplicate question: expected no open question titled "消すか" on issue 1, actual question 1 is open; force to ask again`)
	if mustSave(t, directory, records, SaveInput{Title: str("消すか")}, fixedNow).ID != "2" {
		t.Fatal("other issue")
	}
	_, err = SaveQuestion(directory, records, SaveInput{Title: str("消すか")}, &fixedNow)
	requireError(t, err, `duplicate question: expected no open question titled "消すか" without an issue, actual question 2 is open; force to ask again`)
	if mustSave(t, directory, records, SaveInput{Title: str("消すか"), Issue: str("1"), Force: true}, fixedNow).ID != "3" {
		t.Fatal("force")
	}
	mustAnswer(t, directory, records, "1", AnswerInput{Body: str("yes")}, fixedNow)
	mustSave(t, directory, records, SaveInput{ID: str("3"), Status: str("canceled")}, fixedNow)
	if mustSave(t, directory, records, SaveInput{Title: str("消すか"), Issue: str("1")}, fixedNow).ID != "4" {
		t.Fatal("after closed")
	}
	later := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	mustSave(t, directory, nil, SaveInput{Title: str("expired twin"), AnswerBy: str("1h")}, fixedNow)
	if mustSave(t, directory, nil, SaveInput{Title: str("expired twin"), AnswerBy: str("1h")}, later).ID == "" {
		t.Fatal("expired should not block")
	}
}

func TestAnswerConflict(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("q")}, fixedNow)
	mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("first")}, fixedNow)
	_, err := AnswerQuestion(directory, nil, "1", AnswerInput{Body: str("stale tab"), ExpectedStatus: str("open")}, &fixedNow)
	var conflict *QuestionConflictError
	if !errors.As(err, &conflict) {
		t.Fatal(err)
	}
	want := "cannot answer question 1: expected status open or expired, actual answered (answered by Spec Author at 2026-09-25T09:00:00.000Z; force to replace the answer)"
	if conflict.Error() != want || conflict.Question.Answer == nil || *conflict.Question.Answer != "first" {
		t.Fatalf("%s %#v", conflict.Error(), conflict.Question.Answer)
	}
	if mustGet(t, directory, "1", fixedNow).Answer == nil || *mustGet(t, directory, "1", fixedNow).Answer != "first" {
		t.Fatal("overwritten")
	}
	later := time.Date(2026, 9, 25, 9, 10, 0, 0, time.UTC)
	edited := mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("edited"), ExpectedStatus: str("answered")}, later)
	if edited.Answer == nil || *edited.Answer != "edited" || edited.AcknowledgedAt != nil {
		t.Fatalf("%#v", edited)
	}
	if mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("forced"), Force: true}, later).Answer == nil {
		t.Fatal("force")
	}
	_, err = AnswerQuestion(directory, nil, "1", AnswerInput{Body: str("x"), ExpectedStatus: str("done")}, &fixedNow)
	requireError(t, err, "invalid expectedStatus: expected open, expired, answered, or canceled, actual done")
	_, err = AnswerQuestion(directory, nil, "9", AnswerInput{Body: str("x"), ExpectedStatus: str("done")}, &fixedNow)
	requireError(t, err, "question not found: 9")
}

func TestExpectedStatusDoesNotHaveToMatch(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("q"), DefaultAction: str("x"), AnswerBy: str("1h")}, fixedNow)
	later := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	if mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("yes"), ExpectedStatus: str("open")}, later).Status != "answered" {
		t.Fatal("expired")
	}
	mustSave(t, directory, nil, SaveInput{Title: str("other")}, fixedNow)
	if mustAnswer(t, directory, nil, "2", AnswerInput{Body: str("yes"), ExpectedStatus: str("canceled")}, fixedNow).Status != "answered" {
		t.Fatal("expected canceled still answers an open question")
	}
}

func TestCancelRules(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("a")}, fixedNow)
	mustSave(t, directory, nil, SaveInput{Title: str("b")}, fixedNow)
	canceled := mustCancel(t, directory, "1", fixedNow)
	if canceled.Status != "canceled" || canceled.CanceledAt == nil || *canceled.CanceledAt != "2026-09-25T09:00:00.000Z" {
		t.Fatalf("%#v", canceled)
	}
	before := readText(t, filepath.Join(directory.Dir, "questions", "1.md"))
	again := mustCancel(t, directory, "1", time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC))
	if again.CanceledAt == nil || *again.CanceledAt != "2026-09-25T09:00:00.000Z" {
		t.Fatal("canceledAt moved")
	}
	if readText(t, filepath.Join(directory.Dir, "questions", "1.md")) != before {
		t.Fatal("rewrote a canceled question")
	}
	mustAnswer(t, directory, nil, "2", AnswerInput{Body: str("yes")}, fixedNow)
	_, err := CancelQuestion(directory, "2", &fixedNow)
	var conflict *QuestionConflictError
	if !errors.As(err, &conflict) || conflict.Error() != "cannot cancel question 2: expected status open or expired, actual answered" {
		t.Fatalf("%v", err)
	}
}

func TestAcknowledgeAndExpiringNotice(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("q"), AnswerBy: str("1h")}, fixedNow)
	if mustAcknowledge(t, directory, "1", fixedNow).AcknowledgedAt != nil {
		t.Fatal("open")
	}
	mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("yes")}, fixedNow)
	first := time.Date(2026, 9, 25, 9, 30, 0, 0, time.UTC)
	acknowledged := mustAcknowledge(t, directory, "1", first)
	if acknowledged.AcknowledgedAt == nil || *acknowledged.AcknowledgedAt != "2026-09-25T09:30:00.000Z" || acknowledged.UpdatedAt != "2026-09-25T09:00:00.000Z" {
		t.Fatalf("%#v", acknowledged)
	}
	before := readText(t, filepath.Join(directory.Dir, "questions", "1.md"))
	second := mustAcknowledge(t, directory, "1", time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC))
	if second.AcknowledgedAt == nil || *second.AcknowledgedAt != "2026-09-25T09:30:00.000Z" {
		t.Fatal("second")
	}
	if readText(t, filepath.Join(directory.Dir, "questions", "1.md")) != before {
		t.Fatal("rewrote acknowledge")
	}
	if mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("no"), Force: true}, first).AcknowledgedAt != nil {
		t.Fatal("reset")
	}
	mustSave(t, directory, nil, SaveInput{Title: str("notice"), AnswerBy: str("1h")}, fixedNow)
	noticed := time.Date(2026, 9, 25, 9, 50, 0, 0, time.UTC)
	marked := mustMark(t, directory, "2", noticed)
	if marked.NotifiedExpiringAt == nil || *marked.NotifiedExpiringAt != "2026-09-25T09:50:00.000Z" || marked.UpdatedAt != "2026-09-25T09:00:00.000Z" {
		t.Fatalf("%#v", marked)
	}
	again := mustMark(t, directory, "2", time.Date(2026, 9, 25, 9, 55, 0, 0, time.UTC))
	if again.NotifiedExpiringAt == nil || *again.NotifiedExpiringAt != "2026-09-25T09:55:00.000Z" || again.UpdatedAt != "2026-09-25T09:00:00.000Z" {
		t.Fatalf("second notice %#v", again)
	}
}

func TestQuestionsAboutToExpire(t *testing.T) {
	directory := newDirectory(t)
	mustSave(t, directory, nil, SaveInput{Title: str("soon"), AnswerBy: str("1h")}, fixedNow)
	mustSave(t, directory, nil, SaveInput{Title: str("later"), AnswerBy: str("3h")}, fixedNow)
	mustSave(t, directory, nil, SaveInput{Title: str("short"), AnswerBy: str("10m")}, time.Date(2026, 9, 25, 9, 45, 0, 0, time.UTC))
	mustSave(t, directory, nil, SaveInput{Title: str("answered"), AnswerBy: str("1h")}, fixedNow)
	mustAnswer(t, directory, nil, "4", AnswerInput{Body: str("yes")}, fixedNow)
	mustSave(t, directory, nil, SaveInput{Title: str("noticed"), AnswerBy: str("1h")}, fixedNow)
	mustMark(t, directory, "5", fixedNow)
	now := time.Date(2026, 9, 25, 9, 50, 0, 0, time.UTC)
	if ids(QuestionsAboutToExpire(mustList(t, directory, QuestionFilter{}, now), now)) != "1" {
		t.Fatal(ids(QuestionsAboutToExpire(mustList(t, directory, QuestionFilter{}, now), now)))
	}
	exact := Question{Status: "open", AnswerBy: str("2026-09-25T09:15:00.000Z"), CreatedAt: "2026-09-25T09:00:00.000Z", ID: "x"}
	if len(QuestionsAboutToExpire([]Question{exact}, time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC))) != 0 {
		t.Fatal("lifetime equal to the window is excluded")
	}
	justOver := Question{Status: "open", AnswerBy: str("2026-09-25T09:15:00.001Z"), CreatedAt: "2026-09-25T09:00:00.000Z", ID: "y"}
	if ids(QuestionsAboutToExpire([]Question{justOver}, time.Date(2026, 9, 25, 9, 0, 0, 1_000_000, time.UTC))) != "y" {
		t.Fatal("boundary")
	}
}

func TestValidationErrors(t *testing.T) {
	directory := newDirectory(t)
	_, err := SaveQuestion(directory, nil, SaveInput{}, &fixedNow)
	requireError(t, err, "title is required when creating a question")
	_, err = SaveQuestion(directory, nil, SaveInput{Title: str("q"), Issue: str("9")}, &fixedNow)
	requireError(t, err, "issue not found: 9")
	_, err = SaveQuestion(directory, nil, SaveInput{Title: str("q"), Priority: str("now")}, &fixedNow)
	requireError(t, err, "invalid priority: expected urgent, high, medium, or low, actual now")
	_, err = SaveQuestion(directory, nil, SaveInput{ID: str("9"), Priority: str("now")}, &fixedNow)
	requireError(t, err, "invalid priority: expected urgent, high, medium, or low, actual now")
	_, err = SaveQuestion(directory, nil, SaveInput{Title: str("q"), Body: str("a\n" + QuestionAnswerMarker + "\nb")}, &fixedNow)
	requireError(t, err, "invalid body: must not contain "+QuestionAnswerMarker)
	_, err = SaveQuestion(directory, nil, SaveInput{ID: str("9"), Title: str("q")}, &fixedNow)
	requireError(t, err, "question not found: 9")
	_, err = SaveQuestion(directory, nil, SaveInput{ID: str("1"), Status: str("answered")}, &fixedNow)
	requireError(t, err, "invalid status: expected open or canceled, actual answered")
	mustSave(t, directory, nil, SaveInput{Title: str("q")}, fixedNow)
	before := readText(t, filepath.Join(directory.Dir, "questions", "1.md"))
	_, err = AnswerQuestion(directory, nil, "1", AnswerInput{Body: str(" ")}, &fixedNow)
	requireError(t, err, `invalid answer: expected a non-empty string, actual " "`)
	_, err = AnswerQuestion(directory, nil, "1", AnswerInput{}, &fixedNow)
	requireError(t, err, `invalid answer: expected a non-empty string, actual ""`)
	_, err = AnswerQuestion(directory, nil, "1", AnswerInput{Body: str(" \n ")}, &fixedNow)
	requireError(t, err, `invalid answer: expected a non-empty string, actual " \n "`)
	_, err = AnswerQuestion(directory, nil, "1", AnswerInput{Body: str("x " + QuestionAnswerMarker)}, &fixedNow)
	requireError(t, err, "invalid body: must not contain "+QuestionAnswerMarker)
	_, err = SaveQuestion(directory, nil, SaveInput{ID: str("1"), Title: str("  \n  ")}, &fixedNow)
	requireError(t, err, `invalid title: expected a non-empty string, actual "  \n  "`)
	if readText(t, filepath.Join(directory.Dir, "questions", "1.md")) != before {
		t.Fatal("validation wrote")
	}
	if _, err := os.Stat(filepath.Join(directory.Dir, "questions", "2.md")); !os.IsNotExist(err) {
		t.Fatal("failed create left a file")
	}
}

func TestSingleLineAndTitleNone(t *testing.T) {
	directory := newDirectory(t)
	created := mustSave(t, directory, nil, SaveInput{Title: str("a\n\nb"), DefaultAction: str("c\nd")}, fixedNow)
	if created.Title != "a b" || created.DefaultAction == nil || *created.DefaultAction != "c d" {
		t.Fatalf("%#v", created)
	}
	none := mustSave(t, directory, nil, SaveInput{Title: str(" none ")}, fixedNow)
	if none.Title != "none" {
		t.Fatal(none.Title)
	}
}

func TestQuestionsGitignore(t *testing.T) {
	root := t.TempDir()
	t.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	command := exec.Command("git", "init", "-q")
	command.Dir = root
	if err := command.Run(); err != nil {
		t.Fatal(err)
	}
	directory := Directory{Dir: filepath.Join(root, ".yaru")}
	if err := os.MkdirAll(directory.Dir, 0o755); err != nil {
		t.Fatal(err)
	}
	mustSave(t, directory, nil, SaveInput{Title: str("q")}, fixedNow)
	ignore := readText(t, filepath.Join(directory.Dir, "questions", ".gitignore"))
	if ignore != "*\n" {
		t.Fatalf("%q", ignore)
	}
	status := exec.Command("git", "status", "--porcelain", "--untracked-files=all")
	status.Dir = root
	output, err := status.Output()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(output), "questions") {
		t.Fatalf("git status:\n%s", output)
	}
	if err := os.WriteFile(filepath.Join(directory.Dir, "questions", ".gitignore"), []byte("keep\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	mustSave(t, directory, nil, SaveInput{Title: str("second")}, fixedNow)
	if readText(t, filepath.Join(directory.Dir, "questions", ".gitignore")) != "keep\n" {
		t.Fatal("overwrote gitignore")
	}
}

func TestUndoAnswer(t *testing.T) {
	directory := newDirectory(t)
	records := issueOne()
	mustSave(t, directory, nil, SaveInput{Title: str("q"), AnswerBy: str("2h")}, fixedNow)
	mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("消してよい")}, fixedNow)
	within := fixedNow.Add(time.Duration(UndoAnswerMilliseconds) * time.Millisecond)
	undone := mustUndo(t, directory, "1", UndoInput{AnsweredAt: str("2026-09-25T09:00:00.000Z")}, within)
	if undone.Status != "open" || undone.Answer != nil || undone.AnsweredBy != nil || undone.AnsweredAt != nil || undone.UpdatedAt != "2026-09-25T09:00:30.000Z" {
		t.Fatalf("%#v", undone)
	}
	mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("yes")}, fixedNow)
	justOver := fixedNow.Add(time.Duration(UndoAnswerMilliseconds)*time.Millisecond + time.Millisecond)
	_, err := UndoAnswer(directory, "1", UndoInput{AnsweredAt: str("2026-09-25T09:00:00.000Z")}, &justOver)
	requireError(t, err, "cannot undo the answer to question 1: expected within 30s of answering, actual 30s")
	half := fixedNow.Add(30500 * time.Millisecond)
	_, err = UndoAnswer(directory, "1", UndoInput{AnsweredAt: str("2026-09-25T09:00:00.000Z")}, &half)
	requireError(t, err, "cannot undo the answer to question 1: expected within 30s of answering, actual 31s")
	if mustGet(t, directory, "1", fixedNow).Answer == nil || *mustGet(t, directory, "1", fixedNow).Answer != "yes" {
		t.Fatal("undo wrote")
	}
	mustAcknowledge(t, directory, "1", fixedNow.Add(time.Second))
	_, err = UndoAnswer(directory, "1", UndoInput{AnsweredAt: str("2026-09-25T09:00:00.000Z")}, &within)
	var conflict *QuestionConflictError
	if !errors.As(err, &conflict) || conflict.Error() != "cannot undo the answer to question 1: expected the agent not to have picked it up, actual picked up at 2026-09-25T09:00:01.000Z" {
		t.Fatalf("%v", err)
	}
	mustSave(t, directory, nil, SaveInput{Title: str("replaced")}, fixedNow)
	mustAnswer(t, directory, nil, "2", AnswerInput{Body: str("first")}, fixedNow)
	replacedAt := fixedNow.Add(5 * time.Second)
	mustAnswer(t, directory, nil, "2", AnswerInput{Body: str("second"), Force: true}, replacedAt)
	_, err = UndoAnswer(directory, "2", UndoInput{AnsweredAt: str(fixedNow.UTC().Format("2006-01-02T15:04:05.000Z"))}, &within)
	requireError(t, err, "cannot undo the answer to question 2: expected answeredAt 2026-09-25T09:00:00.000Z, actual 2026-09-25T09:00:05.000Z")
	mustSave(t, directory, nil, SaveInput{Title: str("plain")}, fixedNow)
	_, err = UndoAnswer(directory, "3", UndoInput{}, &within)
	requireError(t, err, "cannot undo the answer to question 3: expected status answered, actual open")
	_, err = UndoAnswer(directory, "9", UndoInput{}, &within)
	requireError(t, err, "question not found: 9")
	mustSave(t, directory, records, SaveInput{Title: str("late"), Issue: str("1"), DefaultAction: str("x"), AnswerBy: str("2026-09-25T08:00:00.000Z")}, time.Date(2026, 9, 25, 7, 0, 0, 0, time.UTC))
	mustAnswer(t, directory, records, "4", AnswerInput{Body: str("late")}, fixedNow)
	_, err = UndoAnswer(directory, "4", UndoInput{AnsweredAt: str("2026-09-25T09:00:00.000Z")}, &within)
	requireError(t, err, "cannot undo the answer to question 4: expected an answer before answerBy, actual a late answer already added to issue 1 as a comment")
}

func TestUndoAnswerDeadline(t *testing.T) {
	directory := newDirectory(t)
	records := issueOne()
	mustSave(t, directory, nil, SaveInput{Title: str("a")}, fixedNow)
	answered := mustAnswer(t, directory, nil, "1", AnswerInput{Body: str("yes")}, fixedNow)
	deadline := UndoAnswerDeadline(answered)
	if deadline == nil || !deadline.Equal(fixedNow.Add(time.Duration(UndoAnswerMilliseconds)*time.Millisecond)) {
		t.Fatalf("%v", deadline)
	}
	copied := answered
	copied.AcknowledgedAt = str(fixedNow.UTC().Format("2006-01-02T15:04:05.000Z"))
	if UndoAnswerDeadline(copied) != nil {
		t.Fatal("acknowledged")
	}
	mustSave(t, directory, nil, SaveInput{Title: str("b")}, fixedNow)
	if UndoAnswerDeadline(mustGet(t, directory, "2", fixedNow)) != nil {
		t.Fatal("open")
	}
	mustSave(t, directory, records, SaveInput{Title: str("c"), Issue: str("1"), AnswerBy: str("2026-09-25T08:30:00.000Z")}, time.Date(2026, 9, 25, 8, 0, 0, 0, time.UTC))
	if UndoAnswerDeadline(mustAnswer(t, directory, records, "3", AnswerInput{Body: str("late")}, fixedNow)) != nil {
		t.Fatal("late")
	}
}

func TestHandEditedFiles(t *testing.T) {
	directory := newDirectory(t)
	questions := filepath.Join(directory.Dir, "questions")
	if err := os.MkdirAll(questions, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name, text string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(questions, name), []byte(text), 0o666); err != nil {
			t.Fatal(err)
		}
	}
	write("notes.md", "---\ntitle: hand\nstatus: answered\nissue: none\npriority:\ndefaultAction: none\nanswerBy: not-a-date\noptions: [\"a\",\"b\"]\nauthor: none\nsession: none\nworktree:\nbranch:\ncreatedAt: 2026-09-25T09:00:00.000Z\nupdatedAt: 2026-09-25T09:00:00.000Z\n---\n\nbody\n")
	write("bad.md", "not a question\n")
	write("opts.md", "---\ntitle: opts\nstatus: open\noptions: {\"a\":1}\nauthor:\ncreatedAt: 2026-09-25T09:00:00.000Z\nupdatedAt: 2026-09-25T09:00:00.000Z\n---\n\n")
	write("01.md", "---\ntitle: padded\nstatus: open\nauthor:\ncreatedAt: 2026-09-25T08:00:00.000Z\nupdatedAt: 2026-09-25T08:00:00.000Z\n---\n\n")
	write("priority.md", "---\ntitle: bad priority\nstatus: open\npriority: now\nauthor:\ncreatedAt: 2026-09-25T09:00:00.000Z\nupdatedAt: 2026-09-25T09:00:00.000Z\n---\n\n")
	if err := os.Mkdir(filepath.Join(questions, "dir.md"), 0o755); err != nil {
		t.Fatal(err)
	}
	notes := mustGet(t, directory, "notes", fixedNow)
	if notes.Status != "open" || notes.Issue != nil || notes.Author != "none" || notes.Session != nil || notes.AnswerBy == nil || *notes.AnswerBy != "not-a-date" || notes.Body != "body" {
		t.Fatalf("%#v", notes)
	}
	_, err := GetQuestion(directory, "bad", &fixedNow)
	requireError(t, err, "invalid issue file")
	_, err = GetQuestion(directory, "opts", &fixedNow)
	requireError(t, err, "invalid question file")
	_, err = GetQuestion(directory, "dir", &fixedNow)
	requireError(t, err, "EISDIR: illegal operation on a directory, read")
	_, err = GetQuestion(directory, "priority", &fixedNow)
	requireError(t, err, "invalid priority: expected urgent, high, medium, or low, actual now")
	listed := mustList(t, directory, QuestionFilter{}, fixedNow)
	if ids(listed) != "notes,01" {
		t.Fatalf("list skipped or reordered: %s", ids(listed))
	}
	if mustSave(t, directory, nil, SaveInput{Title: str("after padded")}, fixedNow).ID != "2" {
		t.Fatal("next id")
	}
	frontmatterID := "---\nid: 9\ntitle: stem\nstatus: open\nauthor:\ncreatedAt: 2026-09-25T09:00:00.000Z\nupdatedAt: 2026-09-25T09:00:00.000Z\n---\n\n"
	write("4.md", frontmatterID)
	updated := mustSave(t, directory, nil, SaveInput{ID: str("4"), Priority: str("low")}, fixedNow)
	if updated.ID != "4" {
		t.Fatal(updated.ID)
	}
	if !strings.Contains(readText(t, filepath.Join(questions, "4.md")), "id: 4\n") {
		t.Fatal("kept the frontmatter id")
	}
	dateOnly := "---\ntitle: date\nstatus: open\nanswerBy: 2026-09-30\nauthor:\ncreatedAt: 2026-09-25T09:00:00.000Z\nupdatedAt: 2026-09-25T09:00:00.000Z\n---\n\n"
	write("date.md", dateOnly)
	if mustGet(t, directory, "date", time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)).Status != "expired" {
		t.Fatal("date-only answerBy should expire at UTC midnight")
	}
	local := "---\ntitle: local\nstatus: open\nanswerBy: 2026/09/30\nauthor:\ncreatedAt: 2026-09-25T09:00:00.000Z\nupdatedAt: 2026-09-25T09:00:00.000Z\n---\n\n"
	write("local.md", local)
	if mustGet(t, directory, "local", time.Date(2026, 9, 29, 15, 0, 0, 0, time.UTC)).Status != "expired" {
		t.Fatal("slash date should expire at Tokyo midnight")
	}
	emptyAnswer := "---\ntitle: empty answer\nstatus: open\nauthor: Spec Author\nansweredBy: Spec Author\nansweredAt: 2026-09-25T09:00:00.000Z\ncreatedAt: 2026-09-25T09:00:00.000Z\nupdatedAt: 2026-09-25T09:00:00.000Z\n---\n\n" + QuestionAnswerMarker + "\n\n\n"
	write("empty-answer.md", emptyAnswer)
	empty := mustGet(t, directory, "empty-answer", fixedNow)
	if empty.Status != "answered" || empty.Answer == nil || *empty.Answer != "" {
		t.Fatalf("%#v", empty)
	}
	canceledAnswer := "---\ntitle: both\nstatus: canceled\nauthor:\ncreatedAt: 2026-09-25T09:00:00.000Z\nupdatedAt: 2026-09-25T09:00:00.000Z\ncanceledAt: 2026-09-25T09:00:00.000Z\n---\n\n" + QuestionAnswerMarker + "\n\nyes\n"
	write("both.md", canceledAnswer)
	if mustGet(t, directory, "both", fixedNow).Status != "canceled" {
		t.Fatal("canceled should win over an answer")
	}
}

func TestNilNowUsesCurrentTime(t *testing.T) {
	t.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	directory := newDirectory(t)
	created, err := SaveQuestion(directory, nil, SaveInput{Title: str("q")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if created.CreatedAt != "2026-09-28T12:00:00.000Z" {
		t.Fatal(created.CreatedAt)
	}
}

func TestCreateRetriesWhenTheFileAppears(t *testing.T) {
	directory := newDirectory(t)
	calls := 0
	previous := createFile
	t.Cleanup(func() { createFile = previous })
	createFile = func(path string, text string) error {
		calls++
		if calls == 1 {
			return os.ErrExist
		}
		return previous(path, text)
	}
	created := mustSave(t, directory, nil, SaveInput{Title: str("q")}, fixedNow)
	if created.ID != "1" || calls != 2 {
		t.Fatalf("id %s calls %d", created.ID, calls)
	}
}

func TestMissingQuestionsDirectoryListsNothing(t *testing.T) {
	directory := newDirectory(t)
	if len(mustList(t, directory, QuestionFilter{}, fixedNow)) != 0 {
		t.Fatal("list")
	}
	_, err := GetQuestion(directory, "1", &fixedNow)
	requireError(t, err, "question not found: 1")
}

func TestCompareNumericIDAndGroups(t *testing.T) {
	open := func(id, created, answerBy, action, status string) Question {
		question := Question{ID: id, Status: status, CreatedAt: created, Options: []string{}}
		if answerBy != "" {
			question.AnswerBy = &answerBy
		}
		if action != "" {
			question.DefaultAction = &action
		}
		return question
	}
	questions := []Question{
		open("10", "2026-09-25T09:00:00.000Z", "2026-09-25T12:00:00.000Z", "x", "open"),
		open("9", "2026-09-25T09:00:00.000Z", "2026-09-25T12:00:00.000Z", "x", "open"),
		open("2", "2026-09-25T09:00:00.000Z", "", "", "expired"),
	}
	questions[2].DefaultAction = nil
	groups := GroupAwaitingQuestions(questions, func(question Question) Question { return question })
	if ids(groups.DueSoon) != "9,10" || ids(groups.Proceeded) != "2" {
		t.Fatalf("due %s proceeded %s", ids(groups.DueSoon), ids(groups.Proceeded))
	}
}

type fakeIssues struct {
	present    map[string]error
	issues     []string
	comments   []string
	commentErr error
}

func (fake *fakeIssues) GetIssue(directory Directory, id string) error {
	fake.issues = append(fake.issues, id)
	if fake.present == nil {
		return errors.New("issue not found: " + id)
	}
	err, ok := fake.present[id]
	if !ok {
		return errors.New("issue not found: " + id)
	}
	return err
}

func (fake *fakeIssues) SaveComment(directory Directory, issueID string, body string) error {
	if fake.commentErr != nil {
		return fake.commentErr
	}
	fake.comments = append(fake.comments, body)
	return nil
}

func issueOne() *fakeIssues {
	return &fakeIssues{present: map[string]error{"1": nil}}
}

func newDirectory(t *testing.T) Directory {
	t.Helper()
	root := t.TempDir()
	directory := filepath.Join(root, ".yaru")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	return Directory{Dir: directory}
}

func str(value string) *string { return &value }

func strs(values ...string) *[]string {
	copied := append([]string(nil), values...)
	return &copied
}

func mustSave(t *testing.T, directory Directory, records IssueRecords, input SaveInput, moment time.Time) Question {
	t.Helper()
	question, err := SaveQuestion(directory, records, input, &moment)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	return question
}

func mustGet(t *testing.T, directory Directory, id string, moment time.Time) Question {
	t.Helper()
	question, err := GetQuestion(directory, id, &moment)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	return question
}

func mustList(t *testing.T, directory Directory, filter QuestionFilter, moment time.Time) []Question {
	t.Helper()
	questions, err := ListQuestions(directory, filter, &moment)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	return questions
}

func mustAnswer(t *testing.T, directory Directory, records IssueRecords, id string, input AnswerInput, moment time.Time) Question {
	t.Helper()
	question, err := AnswerQuestion(directory, records, id, input, &moment)
	if err != nil {
		t.Fatalf("answer: %v", err)
	}
	return question
}

func mustCancel(t *testing.T, directory Directory, id string, moment time.Time) Question {
	t.Helper()
	question, err := CancelQuestion(directory, id, &moment)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	return question
}

func mustAcknowledge(t *testing.T, directory Directory, id string, moment time.Time) Question {
	t.Helper()
	question, err := AcknowledgeQuestion(directory, id, &moment)
	if err != nil {
		t.Fatalf("acknowledge: %v", err)
	}
	return question
}

func mustMark(t *testing.T, directory Directory, id string, moment time.Time) Question {
	t.Helper()
	question, err := MarkExpiringNotified(directory, id, &moment)
	if err != nil {
		t.Fatalf("mark: %v", err)
	}
	return question
}

func mustUndo(t *testing.T, directory Directory, id string, input UndoInput, moment time.Time) Question {
	t.Helper()
	question, err := UndoAnswer(directory, id, input, &moment)
	if err != nil {
		t.Fatalf("undo: %v", err)
	}
	return question
}

func requireError(t *testing.T, err error, message string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error %s", message)
	}
	if err.Error() != message {
		t.Fatalf("error\n got: %s\nwant: %s", err.Error(), message)
	}
}

func readText(t *testing.T, path string) string {
	t.Helper()
	text, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(text)
}

func ids(questions []Question) string {
	values := make([]string, 0, len(questions))
	for _, question := range questions {
		values = append(values, question.ID)
	}
	return strings.Join(values, ",")
}
