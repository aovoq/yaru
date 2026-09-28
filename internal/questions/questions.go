// Package questions は .yaru/questions の質問を読み書きする。
// 期限切れ (expired) は保存せず、読むたびに answerBy と現在時刻から決める (src/questions.ts:21-23)。
// 仕様は docs/spec/yaru-format.md の「question」。
package questions

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/workspace"
)

// 回答は本文の後ろに区切りを挟んで書く。frontmatter は 1 行ずつなので複数行の回答を置けないため (src/questions.ts:29-30)
const QuestionAnswerMarker = "<!-- yaru:answer -->"

// 期限の何分前に知らせるか。知らせを見てから答えを書くのに要る時間の目安 (src/questions.ts:109-110)
const ExpiringNoticeMilliseconds = 15 * 60_000

// 答えてから取り消せるまでの時間 (src/questions.ts:250-252)
const UndoAnswerMilliseconds = 30_000

// StoredQuestionStatuses はファイルに書く status。answered と expired は書かない (src/questions.ts:25)
var StoredQuestionStatuses = []string{"open", "canceled"}

// QuestionStatuses は読むときに決まる状態 (src/questions.ts:26)
var QuestionStatuses = []string{"open", "expired", "answered", "canceled"}

// 優先度は issue と同じ列挙。internal/store は別の作業が作っている (src/store.ts:17)
var priorities = []string{"urgent", "high", "medium", "low"}

// 時刻、JSON、frontmatter、作業ディレクトリは土台の関数を使う。
// time.Now、encoding/json の既定、os.Getwd は使わない。
// docs/spec/yaru-format.md の「時刻」「JSON の escape」「共通の frontmatter」
var (
	formatDocument    = document.Format
	parseDocument     = document.Parse
	marshalJavaScript = document.MarshalJavaScript
	currentTime       = clock.Now
	isoString         = clock.ISOString
	workingDirectory  = workspace.WorkingDirectory
	gitName           = workspace.GitName
	createFile        = createExclusive
)

// Directory は質問ファイルを置く .yaru ディレクトリ。TS 版の Store.dir (src/store.ts:114-117)
type Directory struct {
	Dir string
}

// IssueRecords は issue の存在確認と、期限後の回答をコメントへ写すこと。
// 中身は internal/store。getIssue は staleAfter も検査する (src/questions.ts:580-584, src/store.ts:236)。
// コメントの時刻は saveComment 自身が currentTime で決める (src/questions.ts:236-245, src/store.ts:661-662)。
type IssueRecords interface {
	GetIssue(directory Directory, id string) error
	SaveComment(directory Directory, issueID string, body string) error
}

// Provenance は質問を作ったエージェントの出どころ。作成時だけコピーする (src/questions.ts:172-174, src/provenance.ts:6-13)
type Provenance struct {
	Session  *string
	Worktree *string
	Branch   *string
}

// Question は読んだ質問。status はファイルの値ではなく、今の時刻から決めたもの (src/questions.ts:32-58)
type Question struct {
	ID                 string
	Title              string
	Status             string
	Issue              *string
	Priority           *string
	DefaultAction      *string
	AnswerBy           *string
	Options            []string
	Author             string
	Session            *string
	Worktree           *string
	Branch             *string
	Answer             *string
	AnsweredBy         *string
	AnsweredAt         *string
	AcknowledgedAt     *string
	NotifiedExpiringAt *string
	CanceledAt         *string
	CreatedAt          string
	UpdatedAt          string
	Body               string
}

// SaveInput は作成か更新。nil の項目は更新では変えない (src/questions.ts:60-75)
type SaveInput struct {
	ID            *string
	Title         *string
	Status        *string
	Issue         *string
	Priority      *string
	DefaultAction *string
	AnswerBy      *string
	Options       *[]string
	Provenance    *Provenance
	Force         bool
	Body          *string
}

// AnswerInput は回答。ExpectedStatus が answered のときは、見ていた答えの置き換え (src/questions.ts:77-83)
type AnswerInput struct {
	Body           *string
	ExpectedStatus *string
	Force          bool
}

// UndoInput は取り消したい答えの answeredAt。nil なら突き合わせない (src/questions.ts:254-257)
type UndoInput struct {
	AnsweredAt *string
}

// QuestionFilter は一覧の絞り込み。Status が nil、Issue が空なら、その軸では絞らない (src/questions.ts:112-115)
type QuestionFilter struct {
	Status *string
	Issue  string
}

// AwaitingQuestionGroups は答えを待っている質問を、人が先に見るまとまりに分けたもの (src/questions.ts:102-107)
type AwaitingQuestionGroups[T any] struct {
	Blocking   []T
	DueSoon    []T
	NoDeadline []T
	Proceeded  []T
}

// QuestionConflictError は、人が答える前に状態が変わっていたときの失敗。
// Web では 409 Conflict として返す。
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10
// src/questions.ts:85-95
type QuestionConflictError struct {
	message  string
	Question Question
}

func (err *QuestionConflictError) Error() string { return err.message }

type storedQuestion struct {
	Question
	canceled bool
}

// SaveQuestion は質問を作るか、id があれば更新する (src/questions.ts:119-193)
func SaveQuestion(directory Directory, records IssueRecords, input SaveInput, now *time.Time) (Question, error) {
	moment, err := resolveNow(now)
	if err != nil {
		return Question{}, err
	}
	var storedStatus *string
	if input.Status != nil {
		resolved, statusErr := resolveStoredStatus(*input.Status)
		if statusErr != nil {
			return Question{}, statusErr
		}
		storedStatus = &resolved
	}
	timestamp := isoString(moment)
	priority, prioritySet, err := resolvePriority(input.Priority)
	if err != nil {
		return Question{}, err
	}
	answerBy, answerBySet, err := ResolveAnswerBy(input.AnswerBy, moment)
	if err != nil {
		return Question{}, err
	}
	defaultAction, defaultSet := resolveSingleLine(input.DefaultAction)
	issue, issueSet, err := resolveIssue(directory, records, input.Issue)
	if err != nil {
		return Question{}, err
	}
	options, optionsSet, err := resolveOptions(input.Options)
	if err != nil {
		return Question{}, err
	}
	if input.Body != nil {
		if err := assertBody(*input.Body); err != nil {
			return Question{}, err
		}
	}
	if input.ID != nil && *input.ID != "" {
		path := questionPath(directory, *input.ID)
		if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
			return Question{}, fmt.Errorf("question not found: %s", *input.ID)
		}
		current, readErr := readQuestion(path, *input.ID)
		if readErr != nil {
			return Question{}, readErr
		}
		if input.Title != nil && jsTrim(*input.Title) == "" {
			quoted, quoteErr := javaScriptString(*input.Title)
			if quoteErr != nil {
				return Question{}, quoteErr
			}
			return Question{}, fmt.Errorf("invalid title: expected a non-empty string, actual %s", quoted)
		}
		canceled := current.canceled
		if storedStatus != nil {
			canceled = *storedStatus == "canceled"
		}
		next := current
		if input.Title != nil {
			next.Title = singleLine(*input.Title)
		}
		if issueSet {
			next.Issue = issue
		}
		if prioritySet {
			next.Priority = priority
		}
		if defaultSet {
			next.DefaultAction = defaultAction
		}
		if answerBySet {
			next.AnswerBy = answerBy
		}
		if optionsSet {
			next.Options = options
		}
		if input.Body != nil {
			next.Body = *input.Body
		}
		next.canceled = canceled
		if canceled {
			if current.canceled {
				next.CanceledAt = current.CanceledAt
			} else {
				next.CanceledAt = &timestamp
			}
		} else {
			next.CanceledAt = nil
		}
		next.UpdatedAt = timestamp
		formatted, formatErr := formatQuestion(next)
		if formatErr != nil {
			return Question{}, formatErr
		}
		if err := replaceFile(path, formatted); err != nil {
			return Question{}, err
		}
		return withStatus(next, moment), nil
	}
	if input.Title == nil || jsTrim(*input.Title) == "" {
		return Question{}, errors.New("title is required when creating a question")
	}
	title := singleLine(*input.Title)
	issueValue := issue
	if !issueSet {
		issueValue = nil
	}
	if !input.Force {
		if err := assertNotDuplicate(directory, title, issueValue, moment); err != nil {
			return Question{}, err
		}
	}
	if _, err := EnsureQuestionsDirectory(directory); err != nil {
		return Question{}, err
	}
	for {
		author, nameErr := currentGitName()
		if nameErr != nil {
			return Question{}, nameErr
		}
		identifier, idErr := nextQuestionID(directory)
		if idErr != nil {
			return Question{}, idErr
		}
		created := storedQuestion{Question: Question{
			ID:                 identifier,
			Title:              title,
			Issue:              issueValue,
			Priority:           priority,
			DefaultAction:      defaultAction,
			AnswerBy:           answerBy,
			Options:            nonNilOptions(options),
			Author:             author,
			Session:            provenanceField(input.Provenance, func(provenance Provenance) *string { return provenance.Session }),
			Worktree:           provenanceField(input.Provenance, func(provenance Provenance) *string { return provenance.Worktree }),
			Branch:             provenanceField(input.Provenance, func(provenance Provenance) *string { return provenance.Branch }),
			Answer:             nil,
			AnsweredBy:         nil,
			AnsweredAt:         nil,
			AcknowledgedAt:     nil,
			NotifiedExpiringAt: nil,
			CreatedAt:          timestamp,
			UpdatedAt:          timestamp,
			Body:               "",
		}}
		if input.Body != nil {
			created.Body = *input.Body
		}
		if storedStatus != nil && *storedStatus == "canceled" {
			created.canceled = true
			created.CanceledAt = &timestamp
		}
		formatted, formatErr := formatQuestion(created)
		if formatErr != nil {
			return Question{}, formatErr
		}
		err := createFile(questionPath(directory, created.ID), formatted)
		if err == nil {
			return withStatus(created, moment), nil
		}
		if !errors.Is(err, os.ErrExist) {
			return Question{}, err
		}
	}
}

// AnswerQuestion は質問に答える。期限後で issue があれば、コメントを 1 件足す (src/questions.ts:195-248)
func AnswerQuestion(directory Directory, records IssueRecords, id string, input AnswerInput, now *time.Time) (Question, error) {
	moment, err := resolveNow(now)
	if err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
		return Question{}, fmt.Errorf("question not found: %s", id)
	}
	current, err := readQuestion(path, id)
	if err != nil {
		return Question{}, err
	}
	var expectedStatus string
	if input.ExpectedStatus != nil {
		expectedStatus, err = resolveExpectedStatus(*input.ExpectedStatus)
		if err != nil {
			return Question{}, err
		}
	}
	currentStatus := statusOf(current, moment)
	replacing := input.Force || (input.ExpectedStatus != nil && expectedStatus == "answered")
	if currentStatus == "canceled" || (currentStatus == "answered" && !replacing) {
		message := fmt.Sprintf("cannot answer question %s: expected status open or expired, actual %s", id, currentStatus)
		if currentStatus == "answered" {
			answeredBy := "unknown"
			if current.AnsweredBy != nil {
				answeredBy = *current.AnsweredBy
			}
			answeredAt := "unknown"
			if current.AnsweredAt != nil {
				answeredAt = *current.AnsweredAt
			}
			message += fmt.Sprintf(" (answered by %s at %s; force to replace the answer)", answeredBy, answeredAt)
		}
		return Question{}, &QuestionConflictError{message: message, Question: withStatus(current, moment)}
	}
	body := ""
	if input.Body != nil {
		body = *input.Body
	}
	if jsTrim(body) == "" {
		quoted, quoteErr := javaScriptString(body)
		if quoteErr != nil {
			return Question{}, quoteErr
		}
		return Question{}, fmt.Errorf("invalid answer: expected a non-empty string, actual %s", quoted)
	}
	if err := assertBody(body); err != nil {
		return Question{}, err
	}
	timestamp := isoString(moment)
	author, err := currentGitName()
	if err != nil {
		return Question{}, err
	}
	next := current
	next.Answer = &body
	next.AnsweredBy = &author
	next.AnsweredAt = &timestamp
	next.AcknowledgedAt = nil
	next.UpdatedAt = timestamp
	formatted, err := formatQuestion(next)
	if err != nil {
		return Question{}, err
	}
	if err := replaceFile(path, formatted); err != nil {
		return Question{}, err
	}
	if currentStatus == "expired" && current.Issue != nil {
		phrase := "after answerBy passed"
		if current.DefaultAction != nil {
			phrase = "after the agent proceeded with the default"
		}
		comment := fmt.Sprintf("Late answer to Q%s (%s), %s:\n\n%s", id, current.Title, phrase, body)
		if records == nil {
			return Question{}, fmt.Errorf("issue not found: %s", *current.Issue)
		}
		if err := records.SaveComment(directory, *current.Issue, comment); err != nil {
			return Question{}, err
		}
	}
	return withStatus(next, moment), nil
}

// UndoAnswer は答えたばかりの答えを消して、質問を答え待ちに戻す (src/questions.ts:264-314)
func UndoAnswer(directory Directory, id string, input UndoInput, now *time.Time) (Question, error) {
	moment, err := resolveNow(now)
	if err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
		return Question{}, fmt.Errorf("question not found: %s", id)
	}
	current, err := readQuestion(path, id)
	if err != nil {
		return Question{}, err
	}
	currentStatus := statusOf(current, moment)
	prefix := fmt.Sprintf("cannot undo the answer to question %s", id)
	if currentStatus != "answered" || current.AnsweredAt == nil {
		return Question{}, &QuestionConflictError{
			message:  fmt.Sprintf("%s: expected status answered, actual %s", prefix, currentStatus),
			Question: withStatus(current, moment),
		}
	}
	if input.AnsweredAt != nil && *input.AnsweredAt != *current.AnsweredAt {
		return Question{}, &QuestionConflictError{
			message:  fmt.Sprintf("%s: expected answeredAt %s, actual %s", prefix, *input.AnsweredAt, *current.AnsweredAt),
			Question: withStatus(current, moment),
		}
	}
	if current.AcknowledgedAt != nil {
		return Question{}, &QuestionConflictError{
			message:  fmt.Sprintf("%s: expected the agent not to have picked it up, actual picked up at %s", prefix, *current.AcknowledgedAt),
			Question: withStatus(current, moment),
		}
	}
	if answeredAt, ok := parseJavaScriptTime(*current.AnsweredAt); ok {
		elapsed := moment.Sub(answeredAt)
		if elapsed > time.Duration(UndoAnswerMilliseconds)*time.Millisecond {
			seconds := int(math.Round(float64(elapsed.Milliseconds()) / 1000))
			return Question{}, fmt.Errorf("%s: expected within %ds of answering, actual %ds", prefix, UndoAnswerMilliseconds/1000, seconds)
		}
	}
	if isLateAnswer(current.Issue, current.AnswerBy, *current.AnsweredAt) {
		return Question{}, fmt.Errorf("%s: expected an answer before answerBy, actual a late answer already added to issue %s as a comment", prefix, *current.Issue)
	}
	next := current
	next.Answer = nil
	next.AnsweredBy = nil
	next.AnsweredAt = nil
	next.AcknowledgedAt = nil
	timestamp := isoString(moment)
	next.UpdatedAt = timestamp
	formatted, err := formatQuestion(next)
	if err != nil {
		return Question{}, err
	}
	if err := replaceFile(path, formatted); err != nil {
		return Question{}, err
	}
	return withStatus(next, moment), nil
}

// UndoAnswerDeadline は取り消しの時間が終わる時刻。取り消せない答えなら nil (src/questions.ts:316-323)
func UndoAnswerDeadline(question Question) *time.Time {
	if question.Status != "answered" || question.AnsweredAt == nil || question.AcknowledgedAt != nil {
		return nil
	}
	if isLateAnswer(question.Issue, question.AnswerBy, *question.AnsweredAt) {
		return nil
	}
	answeredAt, ok := parseJavaScriptTime(*question.AnsweredAt)
	if !ok {
		return nil
	}
	deadline := answeredAt.Add(time.Duration(UndoAnswerMilliseconds) * time.Millisecond)
	return &deadline
}

// CancelQuestion は答えを待っている質問を取り下げる (src/questions.ts:331-345)
func CancelQuestion(directory Directory, id string, now *time.Time) (Question, error) {
	moment, err := resolveNow(now)
	if err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
		return Question{}, fmt.Errorf("question not found: %s", id)
	}
	current, err := readQuestion(path, id)
	if err != nil {
		return Question{}, err
	}
	currentStatus := statusOf(current, moment)
	if currentStatus == "canceled" {
		return withStatus(current, moment), nil
	}
	if currentStatus == "answered" {
		return Question{}, &QuestionConflictError{
			message:  fmt.Sprintf("cannot cancel question %s: expected status open or expired, actual answered", id),
			Question: withStatus(current, moment),
		}
	}
	return SaveQuestion(directory, nil, SaveInput{ID: &id, Status: strPtr("canceled")}, &moment)
}

// AcknowledgeQuestion はエージェントが答えを初めて受け取った時刻を残す。updatedAt は変えない (src/questions.ts:347-358)
func AcknowledgeQuestion(directory Directory, id string, now *time.Time) (Question, error) {
	moment, err := resolveNow(now)
	if err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
		return Question{}, fmt.Errorf("question not found: %s", id)
	}
	current, err := readQuestion(path, id)
	if err != nil {
		return Question{}, err
	}
	if statusOf(current, moment) != "answered" || current.AcknowledgedAt != nil {
		return withStatus(current, moment), nil
	}
	next := current
	timestamp := isoString(moment)
	next.AcknowledgedAt = &timestamp
	formatted, err := formatQuestion(next)
	if err != nil {
		return Question{}, err
	}
	if err := replaceFile(path, formatted); err != nil {
		return Question{}, err
	}
	return withStatus(next, moment), nil
}

// MarkExpiringNotified は期限が近いことを知らせた時刻を残す。updatedAt は変えない (src/questions.ts:360-367)
func MarkExpiringNotified(directory Directory, id string, now *time.Time) (Question, error) {
	moment, err := resolveNow(now)
	if err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
		return Question{}, fmt.Errorf("question not found: %s", id)
	}
	current, err := readQuestion(path, id)
	if err != nil {
		return Question{}, err
	}
	next := current
	timestamp := isoString(moment)
	next.NotifiedExpiringAt = &timestamp
	formatted, err := formatQuestion(next)
	if err != nil {
		return Question{}, err
	}
	if err := replaceFile(path, formatted); err != nil {
		return Question{}, err
	}
	return withStatus(next, moment), nil
}

// QuestionsAboutToExpire は、期限が窓の内に来る、まだ知らせていない open の質問 (src/questions.ts:369-379)
func QuestionsAboutToExpire(questions []Question, now time.Time) []Question {
	window := time.Duration(ExpiringNoticeMilliseconds) * time.Millisecond
	result := []Question{}
	for _, question := range questions {
		if question.Status != "open" || question.AnswerBy == nil || question.NotifiedExpiringAt != nil {
			continue
		}
		answerBy, ok := parseJavaScriptTime(*question.AnswerBy)
		if !ok {
			continue
		}
		if createdAt, createdOK := parseJavaScriptTime(question.CreatedAt); createdOK && answerBy.Sub(createdAt) <= window {
			continue
		}
		if answerBy.Sub(now) <= window {
			result = append(result, question)
		}
	}
	return result
}

// GetQuestion は 1 件を読む。壊れていても例外は飲みこまない (src/questions.ts:381-385)
func GetQuestion(directory Directory, id string, now *time.Time) (Question, error) {
	moment, err := resolveNow(now)
	if err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
		return Question{}, fmt.Errorf("question not found: %s", id)
	}
	question, err := readQuestion(path, id)
	if err != nil {
		return Question{}, err
	}
	return withStatus(question, moment), nil
}

// ListQuestions は壊れたファイルを省き、人が先に見る順に並べる (src/questions.ts:387-400)
func ListQuestions(directory Directory, filter QuestionFilter, now *time.Time) ([]Question, error) {
	moment, err := resolveNow(now)
	if err != nil {
		return nil, err
	}
	var status string
	if filter.Status != nil {
		status, err = resolveStatus(*filter.Status)
		if err != nil {
			return nil, err
		}
	}
	raw, err := loadRawQuestions(directory)
	if err != nil {
		return nil, err
	}
	questions := make([]Question, 0, len(raw))
	for _, question := range raw {
		questions = append(questions, withStatus(question, moment))
	}
	sort.SliceStable(questions, func(left, right int) bool {
		return CompareQuestions(questions[left], questions[right]) < 0
	})
	filtered := []Question{}
	for _, question := range questions {
		if status != "" && question.Status != status {
			continue
		}
		if filter.Issue != "" && (question.Issue == nil || *question.Issue != filter.Issue) {
			continue
		}
		filtered = append(filtered, question)
	}
	return filtered, nil
}

// CompareQuestions は人が先に見る順。負なら a が先 (src/questions.ts:402-426)
func CompareQuestions(a Question, b Question) int {
	rank := questionRank(a) - questionRank(b)
	if rank != 0 {
		return rank
	}
	switch questionRank(a) {
	case 0:
		return firstNonZero(compareAnswerBy(a, b), strings.Compare(a.CreatedAt, b.CreatedAt), compareIDAscending(a, b))
	case 1:
		return firstNonZero(compareAnswerBy(a, b), compareIDAscending(a, b))
	case 2:
		return firstNonZero(strings.Compare(b.CreatedAt, a.CreatedAt), compareIDAscending(b, a))
	case 3:
		return firstNonZero(strings.Compare(stringOrEmpty(b.AnswerBy), stringOrEmpty(a.AnswerBy)), compareIDAscending(b, a))
	default:
		return firstNonZero(strings.Compare(resolvedAt(b), resolvedAt(a)), compareIDAscending(b, a))
	}
}

// GroupAwaitingQuestions は答え待ちを 4 つのまとまりに分ける。答え済みと取り下げは入れない (src/questions.ts:428-450)
func GroupAwaitingQuestions[T any](items []T, questionOf func(T) Question) AwaitingQuestionGroups[T] {
	groups := AwaitingQuestionGroups[T]{
		Blocking:   []T{},
		DueSoon:    []T{},
		NoDeadline: []T{},
		Proceeded:  []T{},
	}
	sorted := append([]T(nil), items...)
	sort.SliceStable(sorted, func(left, right int) bool {
		return CompareQuestions(questionOf(sorted[left]), questionOf(sorted[right])) < 0
	})
	for _, item := range sorted {
		switch questionRank(questionOf(item)) {
		case 0:
			groups.Blocking = append(groups.Blocking, item)
		case 1:
			groups.DueSoon = append(groups.DueSoon, item)
		case 2:
			groups.NoDeadline = append(groups.NoDeadline, item)
		case 3:
			groups.Proceeded = append(groups.Proceeded, item)
		}
	}
	return groups
}

// ResolveAnswerBy は 30m / 2h / 1d か ISO 8601 の日時を toISOString の形にする。
// 日付だけはタイムゾーンが曖昧なので受けない。
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
// src/questions.ts:554-578
// 戻り値の provided が false のときは、項目が渡されていない。
func ResolveAnswerBy(value *string, now time.Time) (resolved *string, provided bool, err error) {
	trimmed, provided := blankToNull(value)
	if !provided || trimmed == nil {
		return trimmed, provided, nil
	}
	if amount, unit, ok := parseDuration(*trimmed); ok {
		milliseconds, fits := multiplyDuration(amount, unit)
		if !fits {
			return nil, true, invalidAnswerBy(*value)
		}
		if now.UnixMilli() > 0 && milliseconds > math.MaxInt64-now.UnixMilli() {
			return nil, true, invalidAnswerBy(*value)
		}
		// Date の範囲の外は toISOString が RangeError になり、message は Invalid Date のまま
		// https://tc39.es/ecma262/#sec-time-values-and-time-range
		// https://tc39.es/ecma262/#sec-date.prototype.toisostring
		instant := now.UnixMilli() + milliseconds
		if instant > 8_640_000_000_000_000 || instant < -8_640_000_000_000_000 {
			//nolint:staticcheck // TS の message は大文字で始まる
			return nil, true, errors.New("Invalid Date")
		}
		text := isoString(time.UnixMilli(instant).UTC())
		return &text, true, nil
	}
	if parsed, ok := parseAnswerByInput(*trimmed); ok {
		text := isoString(parsed)
		return &text, true, nil
	}
	return nil, true, invalidAnswerBy(*value)
}

// EnsureQuestionsDirectory は questions と、中身を無視する .gitignore を作る。
// 既にある .gitignore は上書きしない (src/questions.ts:603-612)。
// https://git-scm.com/docs/gitignore
func EnsureQuestionsDirectory(directory Directory) (string, error) {
	questionsDirectory := filepath.Join(directory.Dir, "questions")
	if err := os.MkdirAll(questionsDirectory, 0o777); err != nil {
		return "", err
	}
	ignorePath := filepath.Join(questionsDirectory, ".gitignore")
	if _, err := os.Stat(ignorePath); err == nil {
		return questionsDirectory, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	if err := os.WriteFile(ignorePath, []byte("*\n"), 0o666); err != nil {
		return "", err
	}
	return questionsDirectory, nil
}

func questionRank(question Question) int {
	if question.Status == "open" {
		if question.DefaultAction == nil {
			return 0
		}
		if question.AnswerBy != nil {
			return 1
		}
		return 2
	}
	if question.Status == "expired" {
		return 3
	}
	return 4
}

func compareAnswerBy(a Question, b Question) int {
	if stringOrEmpty(a.AnswerBy) == stringOrEmpty(b.AnswerBy) && (a.AnswerBy == nil) == (b.AnswerBy == nil) {
		return 0
	}
	if a.AnswerBy == nil {
		return 1
	}
	if b.AnswerBy == nil {
		return -1
	}
	return strings.Compare(*a.AnswerBy, *b.AnswerBy)
}

func compareIDAscending(a Question, b Question) int {
	left, leftOK := javaScriptNumber(a.ID)
	right, rightOK := javaScriptNumber(b.ID)
	if !leftOK || !rightOK || math.IsNaN(left) || math.IsNaN(right) {
		return 0
	}
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func resolvedAt(question Question) string {
	if question.AnsweredAt != nil {
		return *question.AnsweredAt
	}
	if question.CanceledAt != nil {
		return *question.CanceledAt
	}
	return question.CreatedAt
}

func withStatus(question storedQuestion, now time.Time) Question {
	question.Status = statusOf(question, now)
	question.Options = nonNilOptions(question.Options)
	return question.Question
}

func statusOf(question storedQuestion, now time.Time) string {
	if question.canceled {
		return "canceled"
	}
	if question.Answer != nil {
		return "answered"
	}
	if question.AnswerBy != nil {
		if parsed, ok := parseJavaScriptTime(*question.AnswerBy); ok && !parsed.After(now) {
			return "expired"
		}
	}
	return "open"
}

func isLateAnswer(issue *string, answerBy *string, answeredAt string) bool {
	if issue == nil || answerBy == nil {
		return false
	}
	answerByTime, answerByOK := parseJavaScriptTime(*answerBy)
	answeredAtTime, answeredAtOK := parseJavaScriptTime(answeredAt)
	if !answerByOK || !answeredAtOK {
		return false
	}
	return !answerByTime.After(answeredAtTime)
}

func resolveStoredStatus(value string) (string, error) {
	trimmed := jsTrim(value)
	if !containsString(StoredQuestionStatuses, trimmed) {
		return "", fmt.Errorf("invalid status: expected %s, actual %s", joinOr(StoredQuestionStatuses), value)
	}
	return trimmed, nil
}

func resolveStatus(value string) (string, error) {
	trimmed := jsTrim(value)
	if !containsString(QuestionStatuses, trimmed) {
		return "", fmt.Errorf("invalid status: expected %s, actual %s", joinOr(QuestionStatuses), value)
	}
	return trimmed, nil
}

func resolveExpectedStatus(value string) (string, error) {
	trimmed := jsTrim(value)
	if !containsString(QuestionStatuses, trimmed) {
		return "", fmt.Errorf("invalid expectedStatus: expected %s, actual %s", joinOr(QuestionStatuses), value)
	}
	return trimmed, nil
}

func resolvePriority(value *string) (*string, bool, error) {
	resolved, provided := blankToNull(value)
	if !provided || resolved == nil {
		return resolved, provided, nil
	}
	if !containsString(priorities, *resolved) {
		return nil, true, fmt.Errorf("invalid priority: expected %s, actual %s", joinOr(priorities), *value)
	}
	return resolved, true, nil
}

func resolveOptions(value *[]string) ([]string, bool, error) {
	if value == nil {
		return nil, false, nil
	}
	options := []string{}
	for _, option := range *value {
		resolved := singleLine(option)
		if resolved == "" {
			quoted, err := javaScriptString(option)
			if err != nil {
				return nil, true, err
			}
			return nil, true, fmt.Errorf("invalid option: expected a non-empty string, actual %s", quoted)
		}
		if containsString(options, resolved) {
			quoted, err := javaScriptString(resolved)
			if err != nil {
				return nil, true, err
			}
			return nil, true, fmt.Errorf("invalid option: expected each option once, actual %s twice", quoted)
		}
		options = append(options, resolved)
	}
	return options, true, nil
}

func resolveIssue(directory Directory, records IssueRecords, value *string) (*string, bool, error) {
	resolved, provided := blankToNull(value)
	if !provided || resolved == nil {
		return resolved, provided, nil
	}
	if records == nil {
		return nil, true, fmt.Errorf("issue not found: %s", *resolved)
	}
	if err := records.GetIssue(directory, *resolved); err != nil {
		return nil, true, err
	}
	return resolved, true, nil
}

func resolveSingleLine(value *string) (*string, bool) {
	resolved, provided := blankToNull(value)
	if !provided || resolved == nil {
		return resolved, provided
	}
	line := singleLine(*resolved)
	return &line, true
}

func assertNotDuplicate(directory Directory, title string, issue *string, now time.Time) error {
	questions, err := loadRawQuestions(directory)
	if err != nil {
		return err
	}
	for _, question := range questions {
		visible := withStatus(question, now)
		sameIssue := (visible.Issue == nil && issue == nil) || (visible.Issue != nil && issue != nil && *visible.Issue == *issue)
		if visible.Status == "open" && visible.Title == title && sameIssue {
			place := "without an issue"
			if issue != nil {
				place = "on issue " + *issue
			}
			quoted, quoteErr := javaScriptString(title)
			if quoteErr != nil {
				return quoteErr
			}
			return fmt.Errorf("duplicate question: expected no open question titled %s %s, actual question %s is open; force to ask again", quoted, place, visible.ID)
		}
	}
	return nil
}

func assertBody(body string) error {
	if strings.Contains(body, QuestionAnswerMarker) {
		return fmt.Errorf("invalid body: must not contain %s", QuestionAnswerMarker)
	}
	return nil
}

func singleLine(value string) string {
	runes := []rune(value)
	var builder strings.Builder
	start := 0
	for index := 0; index < len(runes); index++ {
		if runes[index] != '\n' {
			continue
		}
		left := index
		for left > start && isJavaScriptSpace(runes[left-1]) {
			left--
		}
		right := index + 1
		for right < len(runes) && isJavaScriptSpace(runes[right]) {
			right++
		}
		builder.WriteString(string(runes[start:left]))
		builder.WriteByte(' ')
		start = right
		index = right - 1
	}
	builder.WriteString(string(runes[start:]))
	return jsTrim(builder.String())
}

func blankToNull(value *string) (*string, bool) {
	if value == nil {
		return nil, false
	}
	trimmed := jsTrim(*value)
	if trimmed == "" || trimmed == "none" {
		return nil, true
	}
	return &trimmed, true
}

func jsTrim(value string) string {
	runes := []rune(value)
	start := 0
	for start < len(runes) && isJavaScriptSpace(runes[start]) {
		start++
	}
	end := len(runes)
	for end > start && isJavaScriptSpace(runes[end-1]) {
		end--
	}
	return string(runes[start:end])
}

func isJavaScriptSpace(character rune) bool {
	switch character {
	case '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
		return true
	}
	return character >= '\u2000' && character <= '\u200a'
}

func loadRawQuestions(directory Directory) ([]storedQuestion, error) {
	names, err := questionFileNames(directory)
	if err != nil || names == nil {
		return nil, err
	}
	questions := []storedQuestion{}
	for _, name := range names {
		if !strings.HasSuffix(name, ".md") {
			continue
		}
		question, readErr := readQuestion(filepath.Join(directory.Dir, "questions", name), strings.TrimSuffix(name, ".md"))
		if readErr != nil {
			continue
		}
		questions = append(questions, question)
	}
	return questions, nil
}

func readQuestion(path string, stem string) (storedQuestion, error) {
	info, err := os.Stat(path)
	if err != nil {
		return storedQuestion{}, err
	}
	if info.IsDir() {
		return storedQuestion{}, errors.New("EISDIR: illegal operation on a directory, read")
	}
	text, err := os.ReadFile(path)
	if err != nil {
		return storedQuestion{}, err
	}
	parsed, err := parseDocument(string(text))
	if err != nil {
		return storedQuestion{}, err
	}
	if parsed.Meta["title"] == "" {
		return storedQuestion{}, errors.New("invalid question file")
	}
	options, err := parseOptions(metaOrEmpty(parsed.Meta, "options"))
	if err != nil {
		return storedQuestion{}, err
	}
	priority, _, err := resolvePriority(strPtr(metaOrEmpty(parsed.Meta, "priority")))
	if err != nil {
		return storedQuestion{}, err
	}
	body, answer := splitAnswer(parsed.Body)
	question := storedQuestion{Question: Question{
		ID:                 stem,
		Title:              parsed.Meta["title"],
		Issue:              blankValue(metaOrEmpty(parsed.Meta, "issue")),
		Priority:           priority,
		DefaultAction:      blankValue(metaOrEmpty(parsed.Meta, "defaultAction")),
		AnswerBy:           blankValue(metaOrEmpty(parsed.Meta, "answerBy")),
		Options:            options,
		Author:             parsed.Meta["author"],
		Session:            blankValue(metaOrEmpty(parsed.Meta, "session")),
		Worktree:           blankValue(metaOrEmpty(parsed.Meta, "worktree")),
		Branch:             blankValue(metaOrEmpty(parsed.Meta, "branch")),
		Answer:             answer,
		AnsweredBy:         blankValue(metaOrEmpty(parsed.Meta, "answeredBy")),
		AnsweredAt:         blankValue(metaOrEmpty(parsed.Meta, "answeredAt")),
		AcknowledgedAt:     blankValue(metaOrEmpty(parsed.Meta, "acknowledgedAt")),
		NotifiedExpiringAt: blankValue(metaOrEmpty(parsed.Meta, "notifiedExpiringAt")),
		CanceledAt:         blankValue(metaOrEmpty(parsed.Meta, "canceledAt")),
		CreatedAt:          parsed.Meta["createdAt"],
		UpdatedAt:          parsed.Meta["updatedAt"],
		Body:               body,
	}}
	question.canceled = parsed.Meta["status"] == "canceled"
	return question, nil
}

func splitAnswer(body string) (string, *string) {
	index := strings.Index(body, QuestionAnswerMarker)
	if index < 0 {
		return body, nil
	}
	questionBody := strings.TrimSuffix(body[:index], "\n\n")
	answer := strings.TrimPrefix(body[index+len(QuestionAnswerMarker):], "\n\n")
	return questionBody, &answer
}

func formatQuestion(question storedQuestion) (string, error) {
	body := question.Body
	if question.Answer != nil {
		if question.Body != "" {
			body = question.Body + "\n\n" + QuestionAnswerMarker + "\n\n" + *question.Answer
		} else {
			body = QuestionAnswerMarker + "\n\n" + *question.Answer
		}
	}
	status := "open"
	if question.canceled {
		status = "canceled"
	}
	options := ""
	if len(question.Options) > 0 {
		encoded, err := marshalJavaScript(question.Options)
		if err != nil {
			return "", err
		}
		options = string(encoded)
	}
	return formatDocument([]document.Field{
		{Key: "id", Value: question.ID},
		{Key: "title", Value: question.Title},
		{Key: "status", Value: status},
		{Key: "issue", Value: stringOrEmpty(question.Issue)},
		{Key: "priority", Value: stringOrEmpty(question.Priority)},
		{Key: "defaultAction", Value: stringOrEmpty(question.DefaultAction)},
		{Key: "answerBy", Value: stringOrEmpty(question.AnswerBy)},
		{Key: "options", Value: options},
		{Key: "author", Value: question.Author},
		{Key: "session", Value: stringOrEmpty(question.Session)},
		{Key: "worktree", Value: stringOrEmpty(question.Worktree)},
		{Key: "branch", Value: stringOrEmpty(question.Branch)},
		{Key: "answeredBy", Value: stringOrEmpty(question.AnsweredBy)},
		{Key: "answeredAt", Value: stringOrEmpty(question.AnsweredAt)},
		{Key: "acknowledgedAt", Value: stringOrEmpty(question.AcknowledgedAt)},
		{Key: "notifiedExpiringAt", Value: stringOrEmpty(question.NotifiedExpiringAt)},
		{Key: "canceledAt", Value: stringOrEmpty(question.CanceledAt)},
		{Key: "createdAt", Value: question.CreatedAt},
		{Key: "updatedAt", Value: question.UpdatedAt},
	}, body), nil
}

func parseOptions(value string) ([]string, error) {
	trimmed := jsTrim(value)
	if trimmed == "" {
		return []string{}, nil
	}
	parsed, err := parseJSONStringArray(trimmed)
	if err != nil {
		return nil, errors.New("invalid question file")
	}
	return parsed, nil
}

func questionPath(directory Directory, id string) string {
	return filepath.Join(directory.Dir, "questions", id+".md")
}

func nextQuestionID(directory Directory) (string, error) {
	names, err := questionFileNames(directory)
	if err != nil {
		return "", err
	}
	maxID := 0.0
	for _, name := range names {
		matches := questionFilePattern.FindStringSubmatch(name)
		if matches == nil {
			continue
		}
		number, parseErr := strconv.ParseFloat(matches[1], 64)
		if parseErr != nil || math.IsInf(number, 0) || math.IsNaN(number) {
			continue
		}
		if number > maxID {
			maxID = number
		}
	}
	return strconv.FormatInt(int64(maxID)+1, 10), nil
}

var questionFilePattern = regexp.MustCompile(`^(\d+)\.md$`)

func questionFileNames(directory Directory) ([]string, error) {
	file, err := os.Open(filepath.Join(directory.Dir, "questions"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer func() { _ = file.Close() }()
	return file.Readdirnames(-1)
}

func createExclusive(path string, text string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
	if err != nil {
		return err
	}
	_, writeErr := file.WriteString(text)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}

func replaceFile(path string, text string) error {
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, []byte(text), 0o666); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func currentGitName() (string, error) {
	directory, err := workingDirectory()
	if err != nil {
		return "", err
	}
	return gitName(directory), nil
}

func resolveNow(now *time.Time) (time.Time, error) {
	if now != nil {
		return *now, nil
	}
	return currentTime()
}

func invalidAnswerBy(value string) error {
	return fmt.Errorf("invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual %s", value)
}

var durationPattern = regexp.MustCompile(`^(\d+)([mhd])$`)

func parseDuration(value string) (int64, int64, bool) {
	matches := durationPattern.FindStringSubmatch(value)
	if matches == nil {
		return 0, 0, false
	}
	amount, err := strconv.ParseInt(matches[1], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	switch matches[2] {
	case "m":
		return amount, 60_000, true
	case "h":
		return amount, 3_600_000, true
	default:
		return amount, 86_400_000, true
	}
}

func multiplyDuration(amount int64, unit int64) (int64, bool) {
	if amount == 0 || unit == 0 {
		return 0, true
	}
	if amount > math.MaxInt64/unit {
		return 0, false
	}
	return amount * unit, true
}

var answerByPattern = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$`)

func parseAnswerByInput(value string) (time.Time, bool) {
	matches := answerByPattern.FindStringSubmatch(value)
	if matches == nil {
		return time.Time{}, false
	}
	return componentsToTime(matches[1], matches[2], matches[3], matches[4], matches[5], matches[6], matches[7], matches[8], time.UTC)
}

func parseJavaScriptTime(value string) (time.Time, bool) {
	if parsed, ok := parseAnswerByInput(value); ok {
		return parsed, true
	}
	if matches := dateOnlyPattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[1], matches[2], matches[3], "0", "0", "0", "", "Z", time.UTC)
	}
	if matches := localDateTimePattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[1], matches[2], matches[3], matches[4], matches[5], matches[6], matches[7], "Z", time.Local)
	}
	if matches := slashDatePattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[1], matches[2], matches[3], "0", "0", "0", "", "Z", time.Local)
	}
	if matches := monthFirstPattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[3], matches[1], matches[2], "0", "0", "0", "", "Z", time.Local)
	}
	if matches := spacedDateTimePattern.FindStringSubmatch(value); matches != nil {
		return componentsToTime(matches[1], matches[2], matches[3], matches[4], matches[5], matches[6], matches[7], matches[8], time.UTC)
	}
	return time.Time{}, false
}

var (
	dateOnlyPattern       = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)
	localDateTimePattern  = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$`)
	slashDatePattern      = regexp.MustCompile(`^(\d{4})/(\d{2})/(\d{2})$`)
	monthFirstPattern     = regexp.MustCompile(`^(\d{2})/(\d{2})/(\d{4})$`)
	spacedDateTimePattern = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$`)
)

func componentsToTime(yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone string, location *time.Location) (time.Time, bool) {
	year, yearErr := strconv.Atoi(yearText)
	month, monthErr := strconv.Atoi(monthText)
	day, dayErr := strconv.Atoi(dayText)
	hour, hourErr := strconv.Atoi(hourText)
	minute, minuteErr := strconv.Atoi(minuteText)
	second := 0
	if secondText != "" {
		parsed, err := strconv.Atoi(secondText)
		if err != nil {
			return time.Time{}, false
		}
		second = parsed
	}
	if yearErr != nil || monthErr != nil || dayErr != nil || hourErr != nil || minuteErr != nil {
		return time.Time{}, false
	}
	millisecond := fractionMilliseconds(fraction)
	if month < 1 || month > 12 || day < 1 || day > 31 || minute < 0 || minute > 59 || second < 0 || second > 59 {
		return time.Time{}, false
	}
	if hour == 24 {
		if minute != 0 || second != 0 || millisecond != 0 {
			return time.Time{}, false
		}
		hour = 0
		day++
	} else if hour < 0 || hour > 23 {
		return time.Time{}, false
	}
	moment := time.Date(year, time.Month(month), day, hour, minute, second, millisecond*1_000_000, location)
	if zone == "" || zone == "Z" {
		return moment, true
	}
	sign := 1
	if zone[0] == '-' {
		sign = -1
	}
	offsetHours, err := strconv.Atoi(zone[1:3])
	if err != nil {
		return time.Time{}, false
	}
	offsetMinutes, err := strconv.Atoi(zone[4:6])
	if err != nil {
		return time.Time{}, false
	}
	return moment.Add(-time.Duration(sign) * time.Duration(offsetHours*60+offsetMinutes) * time.Minute), true
}

func fractionMilliseconds(fraction string) int {
	if fraction == "" {
		return 0
	}
	if len(fraction) > 3 {
		fraction = fraction[:3]
	}
	for len(fraction) < 3 {
		fraction += "0"
	}
	parsed, err := strconv.Atoi(fraction)
	if err != nil {
		return 0
	}
	return parsed
}

func javaScriptString(value string) (string, error) {
	encoded, err := marshalJavaScript(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func parseJSONStringArray(text string) ([]string, error) {
	runes := []rune(text)
	index := 0
	index = skipJSONSpace(runes, index)
	if index >= len(runes) || runes[index] != '[' {
		return nil, errors.New("invalid question file")
	}
	index++
	values := []string{}
	index = skipJSONSpace(runes, index)
	if index < len(runes) && runes[index] == ']' {
		return values, nil
	}
	for {
		value, next, err := parseJSONString(runes, index)
		if err != nil {
			return nil, err
		}
		values = append(values, value)
		index = skipJSONSpace(runes, next)
		if index >= len(runes) {
			return nil, errors.New("invalid question file")
		}
		if runes[index] == ']' {
			if skipJSONSpace(runes, index+1) != len(runes) {
				return nil, errors.New("invalid question file")
			}
			return values, nil
		}
		if runes[index] != ',' {
			return nil, errors.New("invalid question file")
		}
		index = skipJSONSpace(runes, index+1)
	}
}

func parseJSONString(runes []rune, index int) (string, int, error) {
	index = skipJSONSpace(runes, index)
	if index >= len(runes) || runes[index] != '"' {
		return "", 0, errors.New("invalid question file")
	}
	index++
	var builder strings.Builder
	for index < len(runes) {
		character := runes[index]
		if character == '"' {
			return builder.String(), index + 1, nil
		}
		if character < 0x20 {
			return "", 0, errors.New("invalid question file")
		}
		if character != '\\' {
			builder.WriteRune(character)
			index++
			continue
		}
		if index+1 >= len(runes) {
			return "", 0, errors.New("invalid question file")
		}
		switch runes[index+1] {
		case '"', '\\', '/':
			builder.WriteRune(runes[index+1])
			index += 2
		case 'b':
			builder.WriteByte('\b')
			index += 2
		case 'f':
			builder.WriteByte('\f')
			index += 2
		case 'n':
			builder.WriteByte('\n')
			index += 2
		case 'r':
			builder.WriteByte('\r')
			index += 2
		case 't':
			builder.WriteByte('\t')
			index += 2
		case 'u':
			character, next, err := parseJSONUnicode(runes, index+2)
			if err != nil {
				return "", 0, err
			}
			builder.WriteRune(character)
			index = next
		default:
			return "", 0, errors.New("invalid question file")
		}
	}
	return "", 0, errors.New("invalid question file")
}

func parseJSONUnicode(runes []rune, index int) (rune, int, error) {
	value, next, err := parseHex4(runes, index)
	if err != nil {
		return 0, 0, err
	}
	if utf16.IsSurrogate(value) {
		if !isHighSurrogate(value) || next+1 >= len(runes) || runes[next] != '\\' || runes[next+1] != 'u' {
			return 0, 0, errors.New("invalid question file")
		}
		low, after, lowErr := parseHex4(runes, next+2)
		if lowErr != nil || !isLowSurrogate(low) {
			return 0, 0, errors.New("invalid question file")
		}
		return utf16.DecodeRune(value, low), after, nil
	}
	return value, next, nil
}

func parseHex4(runes []rune, index int) (rune, int, error) {
	if index+4 > len(runes) {
		return 0, 0, errors.New("invalid question file")
	}
	var value rune
	for _, character := range runes[index : index+4] {
		digit, ok := hexValue(character)
		if !ok {
			return 0, 0, errors.New("invalid question file")
		}
		value = value<<4 | digit
	}
	return value, index + 4, nil
}

func hexValue(character rune) (rune, bool) {
	switch {
	case character >= '0' && character <= '9':
		return character - '0', true
	case character >= 'a' && character <= 'f':
		return character - 'a' + 10, true
	case character >= 'A' && character <= 'F':
		return character - 'A' + 10, true
	default:
		return 0, false
	}
}

func isHighSurrogate(value rune) bool { return value >= 0xD800 && value <= 0xDBFF }
func isLowSurrogate(value rune) bool  { return value >= 0xDC00 && value <= 0xDFFF }

func skipJSONSpace(runes []rune, index int) int {
	for index < len(runes) {
		switch runes[index] {
		case ' ', '\t', '\n', '\r':
			index++
		default:
			return index
		}
	}
	return index
}

func javaScriptNumber(value string) (float64, bool) {
	trimmed := jsTrim(value)
	if trimmed == "" {
		return 0, true
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func joinOr(items []string) string {
	if len(items) <= 2 {
		return strings.Join(items, " or ")
	}
	return strings.Join(items[:len(items)-1], ", ") + ", or " + items[len(items)-1]
}

func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

func firstNonZero(values ...int) int {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func blankValue(value string) *string {
	resolved, _ := blankToNull(&value)
	return resolved
}

func metaOrEmpty(meta map[string]string, key string) string {
	return meta[key]
}

func nonNilOptions(options []string) []string {
	if options == nil {
		return []string{}
	}
	return options
}

func provenanceField(provenance *Provenance, field func(Provenance) *string) *string {
	if provenance == nil {
		return nil
	}
	return copyString(field(*provenance))
}

func copyString(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func strPtr(value string) *string { return &value }
