// Package questions は .yaru/questions の質問を読み書きする。
// 期限切れ (expired) は保存せず、読むたびに answerBy と現在時刻から決める (src/questions.ts:21-23)。
// 仕様は docs/spec/yaru-format.md の「question」。
package questions

import (
	"context"
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
	"github.com/aovoq/yaru/internal/errs"
	"github.com/aovoq/yaru/internal/fsutil"
	"github.com/aovoq/yaru/internal/store"
)

// 回答は本文の後ろに区切りを挟んで書く。frontmatter は 1 行ずつなので複数行の回答を置けないため (src/questions.ts:29-30)
const QuestionAnswerMarker = "<!-- yaru:answer -->"

// 期限の何分前に知らせるか。知らせを見てから答えを書くのに要る時間の目安 (src/questions.ts:109-110)
const ExpiringNoticeMilliseconds = 15 * 60_000

// 答えてから取り消せるまでの時間 (src/questions.ts:250-252)
const UndoAnswerMilliseconds = 30_000

// StoredQuestionStatuses はファイルに書く status の写し。 answered と expired は書かない (src/questions.ts:25)。
func StoredQuestionStatuses() []string {
	return []string{"open", "canceled"}
}

// QuestionStatuses は読むときに決まる状態の写し (src/questions.ts:26)。
func QuestionStatuses() []string {
	return []string{"open", "expired", "answered", "canceled"}
}

// Service は質問の読み書き。時刻と著者は引数で、 YARU_NOW と git は読まない。
// docs/spec/yaru-format.md の「時刻」「JSON の escape」「共通の frontmatter」
type Service struct {
	formatDocument    func(fields []document.Field, body string) string
	parseDocument     func(text string) (document.Document, error)
	marshalJavaScript func(value any) ([]byte, error)
	isoString         func(moment time.Time) string
}

// NewService は frontmatter と ISO 時刻の既定を document と clock にする。
func NewService() *Service {
	return &Service{
		formatDocument:    document.Format,
		parseDocument:     document.Parse,
		marshalJavaScript: document.MarshalJavaScript,
		isoString:         clock.ISOString,
	}
}

// Directory は質問ファイルを置く .yaru ディレクトリ。TS 版の Store.dir (src/store.ts:114-117)
type Directory struct {
	Dir string
}

// IssueRecords は issue の存在確認と、期限後の回答をコメントへ写すこと。
// 中身は internal/store。 getIssue は staleAfter も検査する (src/questions.ts:580-584, src/store.ts:236)。
// コメントの時刻と著者は引数の now と author (src/questions.ts:236-245)。
type IssueRecords interface {
	GetIssue(ctx context.Context, directory Directory, id string, now time.Time, author string) error
	SaveComment(ctx context.Context, directory Directory, issueID string, body string, now time.Time, author string) error
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

// Unwrap は errors.Is が errs.ErrConflict に届くようにする。 Error() の文は message のまま。
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10
func (err *QuestionConflictError) Unwrap() error {
	return fmt.Errorf("%s: %w", err.message, errs.ErrConflict)
}

type storedQuestion struct {
	Question
	canceled bool
}

type preparedQuestion struct {
	storedStatus  *string
	timestamp     string
	priority      *string
	prioritySet   bool
	answerBy      *string
	answerBySet   bool
	defaultAction *string
	defaultSet    bool
	issue         *string
	issueSet      bool
	options       []string
	optionsSet    bool
}

// SaveQuestion は質問を作るか、 id があれば更新する。
// 更新は質問ファイルを、作成は questions ディレクトリをロックしてから書く (src/questions.ts:119-193)。
func (service *Service) SaveQuestion(ctx context.Context, directory Directory, records IssueRecords, input SaveInput, now time.Time, author string) (Question, error) {
	if err := ctx.Err(); err != nil {
		return Question{}, err
	}
	prepared, err := service.prepareSave(ctx, directory, records, input, now, author)
	if err != nil {
		return Question{}, err
	}
	if input.ID != nil && *input.ID != "" {
		return service.updateQuestion(ctx, directory, input, now, prepared)
	}
	return service.createQuestion(ctx, directory, input, now, author, prepared)
}

func (service *Service) prepareSave(ctx context.Context, directory Directory, records IssueRecords, input SaveInput, now time.Time, author string) (preparedQuestion, error) {
	prepared := preparedQuestion{timestamp: service.isoString(now)}
	if input.Status != nil {
		resolved, statusErr := resolveStoredStatus(*input.Status)
		if statusErr != nil {
			return preparedQuestion{}, statusErr
		}
		prepared.storedStatus = &resolved
	}
	priority, prioritySet, err := resolvePriority(input.Priority)
	if err != nil {
		return preparedQuestion{}, err
	}
	prepared.priority = priority
	prepared.prioritySet = prioritySet
	answerBy, answerBySet, err := ResolveAnswerBy(input.AnswerBy, now)
	if err != nil {
		return preparedQuestion{}, err
	}
	prepared.answerBy = answerBy
	prepared.answerBySet = answerBySet
	prepared.defaultAction, prepared.defaultSet = resolveSingleLine(input.DefaultAction)
	issue, issueSet, err := resolveIssue(ctx, directory, records, input.Issue, now, author)
	if err != nil {
		return preparedQuestion{}, err
	}
	prepared.issue = issue
	prepared.issueSet = issueSet
	options, optionsSet, err := resolveOptions(input.Options)
	if err != nil {
		return preparedQuestion{}, err
	}
	prepared.options = options
	prepared.optionsSet = optionsSet
	if input.Body != nil {
		if err := assertBody(*input.Body); err != nil {
			return preparedQuestion{}, err
		}
	}
	return prepared, nil
}

func (service *Service) updateQuestion(ctx context.Context, directory Directory, input SaveInput, now time.Time, prepared preparedQuestion) (Question, error) {
	path := questionPath(directory, *input.ID)
	unlock, err := lockQuestion(ctx, path, *input.ID)
	if err != nil {
		return Question{}, err
	}
	defer unlock()
	current, err := service.readExisting(path, *input.ID)
	if err != nil {
		return Question{}, err
	}
	if input.Title != nil && document.Trim(*input.Title) == "" {
		quoted, quoteErr := document.Quote(*input.Title)
		if quoteErr != nil {
			return Question{}, quoteErr
		}
		return Question{}, failure(fmt.Sprintf("invalid title: expected a non-empty string, actual %s", quoted))
	}
	canceled := current.canceled
	if prepared.storedStatus != nil {
		canceled = *prepared.storedStatus == "canceled"
	}
	next := current
	if input.Title != nil {
		next.Title = singleLine(*input.Title)
	}
	if prepared.issueSet {
		next.Issue = prepared.issue
	}
	if prepared.prioritySet {
		next.Priority = prepared.priority
	}
	if prepared.defaultSet {
		next.DefaultAction = prepared.defaultAction
	}
	if prepared.answerBySet {
		next.AnswerBy = prepared.answerBy
	}
	if prepared.optionsSet {
		next.Options = prepared.options
	}
	if input.Body != nil {
		next.Body = *input.Body
	}
	next.canceled = canceled
	if canceled {
		if current.canceled {
			next.CanceledAt = current.CanceledAt
		} else {
			canceledAt := prepared.timestamp
			next.CanceledAt = &canceledAt
		}
	} else {
		next.CanceledAt = nil
	}
	next.UpdatedAt = prepared.timestamp
	if err := service.commit(path, next); err != nil {
		return Question{}, err
	}
	return withStatus(next, now), nil
}

func (service *Service) createQuestion(ctx context.Context, directory Directory, input SaveInput, now time.Time, author string, prepared preparedQuestion) (Question, error) {
	if input.Title == nil || document.Trim(*input.Title) == "" {
		return Question{}, failure("title is required when creating a question")
	}
	title := singleLine(*input.Title)
	issue := prepared.issue
	if !prepared.issueSet {
		issue = nil
	}
	questionsDirectory, err := service.EnsureQuestionsDirectory(ctx, directory)
	if err != nil {
		return Question{}, err
	}
	unlock, err := fsutil.Lock(ctx, questionsDirectory)
	if err != nil {
		return Question{}, err
	}
	defer unlock()
	if !input.Force {
		if err := service.assertNotDuplicate(ctx, directory, title, issue, now); err != nil {
			return Question{}, err
		}
	}
	for {
		if err := ctx.Err(); err != nil {
			return Question{}, err
		}
		identifier, idErr := nextQuestionID(directory)
		if idErr != nil {
			return Question{}, idErr
		}
		created := storedQuestion{Question: Question{
			ID:                 identifier,
			Title:              title,
			Issue:              issue,
			Priority:           prepared.priority,
			DefaultAction:      prepared.defaultAction,
			AnswerBy:           prepared.answerBy,
			Options:            nonNilOptions(prepared.options),
			Author:             author,
			Session:            provenanceField(input.Provenance, func(provenance Provenance) *string { return provenance.Session }),
			Worktree:           provenanceField(input.Provenance, func(provenance Provenance) *string { return provenance.Worktree }),
			Branch:             provenanceField(input.Provenance, func(provenance Provenance) *string { return provenance.Branch }),
			Answer:             nil,
			AnsweredBy:         nil,
			AnsweredAt:         nil,
			AcknowledgedAt:     nil,
			NotifiedExpiringAt: nil,
			CreatedAt:          prepared.timestamp,
			UpdatedAt:          prepared.timestamp,
			Body:               "",
		}}
		if input.Body != nil {
			created.Body = *input.Body
		}
		if prepared.storedStatus != nil && *prepared.storedStatus == "canceled" {
			created.canceled = true
			canceledAt := prepared.timestamp
			created.CanceledAt = &canceledAt
		}
		formatted, formatErr := service.formatQuestion(created)
		if formatErr != nil {
			return Question{}, formatErr
		}
		writeErr := fsutil.WriteCreate(questionPath(directory, created.ID), formatted)
		if writeErr == nil {
			return withStatus(created, now), nil
		}
		if !errors.Is(writeErr, os.ErrExist) {
			return Question{}, writeErr
		}
	}
}

// AnswerQuestion は質問に答える。期限後で issue があれば、コメントを 1 件足す (src/questions.ts:195-248)。
// 質問ファイルをロックしてから読む。
func (service *Service) AnswerQuestion(ctx context.Context, directory Directory, records IssueRecords, id string, input AnswerInput, now time.Time, author string) (Question, error) {
	if err := ctx.Err(); err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	unlock, err := lockQuestion(ctx, path, id)
	if err != nil {
		return Question{}, err
	}
	defer unlock()
	current, err := service.readExisting(path, id)
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
	currentStatus := statusOf(current, now)
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
		return Question{}, questionConflict(message, withStatus(current, now))
	}
	body := ""
	if input.Body != nil {
		body = *input.Body
	}
	if document.Trim(body) == "" {
		quoted, quoteErr := document.Quote(body)
		if quoteErr != nil {
			return Question{}, quoteErr
		}
		return Question{}, failure(fmt.Sprintf("invalid answer: expected a non-empty string, actual %s", quoted))
	}
	if err := assertBody(body); err != nil {
		return Question{}, err
	}
	timestamp := service.isoString(now)
	answeredBy := author
	next := current
	next.Answer = &body
	next.AnsweredBy = &answeredBy
	next.AnsweredAt = &timestamp
	next.AcknowledgedAt = nil
	next.UpdatedAt = timestamp
	if err := service.commit(path, next); err != nil {
		return Question{}, err
	}
	if currentStatus == "expired" && current.Issue != nil {
		phrase := "after answerBy passed"
		if current.DefaultAction != nil {
			phrase = "after the agent proceeded with the default"
		}
		comment := fmt.Sprintf("Late answer to Q%s (%s), %s:\n\n%s", id, current.Title, phrase, body)
		if records == nil {
			return Question{}, failure(fmt.Sprintf("issue not found: %s", *current.Issue))
		}
		if err := records.SaveComment(ctx, directory, *current.Issue, comment, now, author); err != nil {
			return Question{}, classify(err)
		}
	}
	return withStatus(next, now), nil
}

// UndoAnswer は答えたばかりの答えを消して、質問を答え待ちに戻す (src/questions.ts:264-314)。
func (service *Service) UndoAnswer(ctx context.Context, directory Directory, id string, input UndoInput, now time.Time) (Question, error) {
	if err := ctx.Err(); err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	unlock, err := lockQuestion(ctx, path, id)
	if err != nil {
		return Question{}, err
	}
	defer unlock()
	current, err := service.readExisting(path, id)
	if err != nil {
		return Question{}, err
	}
	currentStatus := statusOf(current, now)
	prefix := fmt.Sprintf("cannot undo the answer to question %s", id)
	if currentStatus != "answered" || current.AnsweredAt == nil {
		return Question{}, questionConflict(fmt.Sprintf("%s: expected status answered, actual %s", prefix, currentStatus), withStatus(current, now))
	}
	if input.AnsweredAt != nil && *input.AnsweredAt != *current.AnsweredAt {
		return Question{}, questionConflict(fmt.Sprintf("%s: expected answeredAt %s, actual %s", prefix, *input.AnsweredAt, *current.AnsweredAt), withStatus(current, now))
	}
	if current.AcknowledgedAt != nil {
		return Question{}, questionConflict(fmt.Sprintf("%s: expected the agent not to have picked it up, actual picked up at %s", prefix, *current.AcknowledgedAt), withStatus(current, now))
	}
	if answeredAt, ok := clock.ParseJavaScriptTime(*current.AnsweredAt); ok {
		elapsed := now.Sub(answeredAt)
		if elapsed > time.Duration(UndoAnswerMilliseconds)*time.Millisecond {
			seconds := int(math.Round(float64(elapsed.Milliseconds()) / 1000))
			return Question{}, failure(fmt.Sprintf("%s: expected within %ds of answering, actual %ds", prefix, UndoAnswerMilliseconds/1000, seconds))
		}
	}
	if isLateAnswer(current.Issue, current.AnswerBy, *current.AnsweredAt) {
		return Question{}, failure(fmt.Sprintf("%s: expected an answer before answerBy, actual a late answer already added to issue %s as a comment", prefix, *current.Issue))
	}
	next := current
	next.Answer = nil
	next.AnsweredBy = nil
	next.AnsweredAt = nil
	next.AcknowledgedAt = nil
	next.UpdatedAt = service.isoString(now)
	if err := service.commit(path, next); err != nil {
		return Question{}, err
	}
	return withStatus(next, now), nil
}

// UndoAnswerDeadline は取り消しの時間が終わる時刻。取り消せない答えなら nil (src/questions.ts:316-323)
func UndoAnswerDeadline(question Question) *time.Time {
	if question.Status != "answered" || question.AnsweredAt == nil || question.AcknowledgedAt != nil {
		return nil
	}
	if isLateAnswer(question.Issue, question.AnswerBy, *question.AnsweredAt) {
		return nil
	}
	answeredAt, ok := clock.ParseJavaScriptTime(*question.AnsweredAt)
	if !ok {
		return nil
	}
	deadline := answeredAt.Add(time.Duration(UndoAnswerMilliseconds) * time.Millisecond)
	return &deadline
}

// CancelQuestion は答えを待っている質問を取り下げる (src/questions.ts:331-345)。
func (service *Service) CancelQuestion(ctx context.Context, directory Directory, id string, now time.Time) (Question, error) {
	if err := ctx.Err(); err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	unlock, err := lockQuestion(ctx, path, id)
	if err != nil {
		return Question{}, err
	}
	defer unlock()
	current, err := service.readExisting(path, id)
	if err != nil {
		return Question{}, err
	}
	currentStatus := statusOf(current, now)
	if currentStatus == "canceled" {
		return withStatus(current, now), nil
	}
	if currentStatus == "answered" {
		return Question{}, questionConflict(fmt.Sprintf("cannot cancel question %s: expected status open or expired, actual answered", id), withStatus(current, now))
	}
	timestamp := service.isoString(now)
	next := current
	next.canceled = true
	next.CanceledAt = &timestamp
	next.UpdatedAt = timestamp
	if err := service.commit(path, next); err != nil {
		return Question{}, err
	}
	return withStatus(next, now), nil
}

// AcknowledgeQuestion はエージェントが答えを初めて受け取った時刻を残す。 updatedAt は変えない (src/questions.ts:347-358)。
func (service *Service) AcknowledgeQuestion(ctx context.Context, directory Directory, id string, now time.Time) (Question, error) {
	if err := ctx.Err(); err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	unlock, err := lockQuestion(ctx, path, id)
	if err != nil {
		return Question{}, err
	}
	defer unlock()
	current, err := service.readExisting(path, id)
	if err != nil {
		return Question{}, err
	}
	if statusOf(current, now) != "answered" || current.AcknowledgedAt != nil {
		return withStatus(current, now), nil
	}
	next := current
	timestamp := service.isoString(now)
	next.AcknowledgedAt = &timestamp
	if err := service.commit(path, next); err != nil {
		return Question{}, err
	}
	return withStatus(next, now), nil
}

// MarkExpiringNotified は期限が近いことを知らせた時刻を残す。 updatedAt は変えない (src/questions.ts:360-367)。
func (service *Service) MarkExpiringNotified(ctx context.Context, directory Directory, id string, now time.Time) (Question, error) {
	if err := ctx.Err(); err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	unlock, err := lockQuestion(ctx, path, id)
	if err != nil {
		return Question{}, err
	}
	defer unlock()
	current, err := service.readExisting(path, id)
	if err != nil {
		return Question{}, err
	}
	next := current
	timestamp := service.isoString(now)
	next.NotifiedExpiringAt = &timestamp
	if err := service.commit(path, next); err != nil {
		return Question{}, err
	}
	return withStatus(next, now), nil
}

// QuestionsAboutToExpire は、期限が窓の内に来る、まだ知らせていない open の質問 (src/questions.ts:369-379)
func QuestionsAboutToExpire(questions []Question, now time.Time) []Question {
	window := time.Duration(ExpiringNoticeMilliseconds) * time.Millisecond
	result := []Question{}
	for _, question := range questions {
		if question.Status != "open" || question.AnswerBy == nil || question.NotifiedExpiringAt != nil {
			continue
		}
		answerBy, ok := clock.ParseJavaScriptTime(*question.AnswerBy)
		if !ok {
			continue
		}
		if createdAt, createdOK := clock.ParseJavaScriptTime(question.CreatedAt); createdOK && answerBy.Sub(createdAt) <= window {
			continue
		}
		if answerBy.Sub(now) <= window {
			result = append(result, question)
		}
	}
	return result
}

// GetQuestion は 1 件を読む。壊れていても例外は飲みこまない (src/questions.ts:381-385)。
func (service *Service) GetQuestion(ctx context.Context, directory Directory, id string, now time.Time) (Question, error) {
	if err := ctx.Err(); err != nil {
		return Question{}, err
	}
	path := questionPath(directory, id)
	unlock, err := lockQuestion(ctx, path, id)
	if err != nil {
		return Question{}, err
	}
	defer unlock()
	question, err := service.readExisting(path, id)
	if err != nil {
		return Question{}, err
	}
	return withStatus(question, now), nil
}

// ListQuestions は壊れたファイルを省き、人が先に見る順に並べる (src/questions.ts:387-400)。
func (service *Service) ListQuestions(ctx context.Context, directory Directory, filter QuestionFilter, now time.Time) ([]Question, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var status string
	if filter.Status != nil {
		resolved, err := resolveStatus(*filter.Status)
		if err != nil {
			return nil, err
		}
		status = resolved
	}
	raw, err := service.loadRawQuestions(ctx, directory)
	if err != nil {
		return nil, err
	}
	questions := make([]Question, 0, len(raw))
	for _, question := range raw {
		questions = append(questions, withStatus(question, now))
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
			return nil, true, failure("Invalid Date")
		}
		text := clock.ISOString(time.UnixMilli(instant).UTC())
		return &text, true, nil
	}
	if answerByPattern.MatchString(*trimmed) {
		if parsed, ok := clock.ParseJavaScriptTime(*trimmed); ok {
			text := clock.ISOString(parsed)
			return &text, true, nil
		}
	}
	return nil, true, invalidAnswerBy(*value)
}

// EnsureQuestionsDirectory は questions と、中身を無視する .gitignore を作る。
// 既にある .gitignore は上書きしない (src/questions.ts:603-612)。
// https://git-scm.com/docs/gitignore
func (service *Service) EnsureQuestionsDirectory(ctx context.Context, directory Directory) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
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
	if err := fsutil.WriteCreate(ignorePath, "*\n"); err != nil {
		if errors.Is(err, os.ErrExist) {
			return questionsDirectory, nil
		}
		return "", err
	}
	return questionsDirectory, nil
}

func (service *Service) commit(path string, question storedQuestion) error {
	formatted, err := service.formatQuestion(question)
	if err != nil {
		return err
	}
	return fsutil.WriteReplace(path, formatted)
}

func questionConflict(message string, question Question) error {
	return &QuestionConflictError{message: message, Question: question}
}

func questionNotFound(id string) error {
	return failure(fmt.Sprintf("question not found: %s", id))
}

func lockQuestion(ctx context.Context, path string, id string) (func(), error) {
	unlock, err := fsutil.Lock(ctx, path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, questionNotFound(id)
		}
		return nil, err
	}
	return unlock, nil
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
	left, leftOK := document.ParseNumber(a.ID)
	right, rightOK := document.ParseNumber(b.ID)
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
		if parsed, ok := clock.ParseJavaScriptTime(*question.AnswerBy); ok && !parsed.After(now) {
			return "expired"
		}
	}
	return "open"
}

func isLateAnswer(issue *string, answerBy *string, answeredAt string) bool {
	if issue == nil || answerBy == nil {
		return false
	}
	answerByTime, answerByOK := clock.ParseJavaScriptTime(*answerBy)
	answeredAtTime, answeredAtOK := clock.ParseJavaScriptTime(answeredAt)
	if !answerByOK || !answeredAtOK {
		return false
	}
	return !answerByTime.After(answeredAtTime)
}

func resolveStoredStatus(value string) (string, error) {
	trimmed := document.Trim(value)
	statuses := StoredQuestionStatuses()
	if !containsString(statuses, trimmed) {
		return "", failure(fmt.Sprintf("invalid status: expected %s, actual %s", joinOr(statuses), value))
	}
	return trimmed, nil
}

func resolveStatus(value string) (string, error) {
	trimmed := document.Trim(value)
	statuses := QuestionStatuses()
	if !containsString(statuses, trimmed) {
		return "", failure(fmt.Sprintf("invalid status: expected %s, actual %s", joinOr(statuses), value))
	}
	return trimmed, nil
}

func resolveExpectedStatus(value string) (string, error) {
	trimmed := document.Trim(value)
	statuses := QuestionStatuses()
	if !containsString(statuses, trimmed) {
		return "", failure(fmt.Sprintf("invalid expectedStatus: expected %s, actual %s", joinOr(statuses), value))
	}
	return trimmed, nil
}

func resolvePriority(value *string) (*string, bool, error) {
	resolved, provided := blankToNull(value)
	if !provided || resolved == nil {
		return resolved, provided, nil
	}
	priorities := store.Priorities()
	if !containsString(priorities, *resolved) {
		return nil, true, failure(fmt.Sprintf("invalid priority: expected %s, actual %s", joinOr(priorities), *value))
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
			quoted, err := document.Quote(option)
			if err != nil {
				return nil, true, err
			}
			return nil, true, failure(fmt.Sprintf("invalid option: expected a non-empty string, actual %s", quoted))
		}
		if containsString(options, resolved) {
			quoted, err := document.Quote(resolved)
			if err != nil {
				return nil, true, err
			}
			return nil, true, failure(fmt.Sprintf("invalid option: expected each option once, actual %s twice", quoted))
		}
		options = append(options, resolved)
	}
	return options, true, nil
}

func resolveIssue(ctx context.Context, directory Directory, records IssueRecords, value *string, now time.Time, author string) (*string, bool, error) {
	resolved, provided := blankToNull(value)
	if !provided || resolved == nil {
		return resolved, provided, nil
	}
	if records == nil {
		return nil, true, failure(fmt.Sprintf("issue not found: %s", *resolved))
	}
	if err := records.GetIssue(ctx, directory, *resolved, now, author); err != nil {
		return nil, true, classify(err)
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

func (service *Service) assertNotDuplicate(ctx context.Context, directory Directory, title string, issue *string, now time.Time) error {
	questions, err := service.loadRawQuestions(ctx, directory)
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
			quoted, quoteErr := document.Quote(title)
			if quoteErr != nil {
				return quoteErr
			}
			return failure(fmt.Sprintf("duplicate question: expected no open question titled %s %s, actual question %s is open; force to ask again", quoted, place, visible.ID))
		}
	}
	return nil
}

func assertBody(body string) error {
	if strings.Contains(body, QuestionAnswerMarker) {
		return failure(fmt.Sprintf("invalid body: must not contain %s", QuestionAnswerMarker))
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
		for left > start && document.IsJavaScriptWhitespace(runes[left-1]) {
			left--
		}
		right := index + 1
		for right < len(runes) && document.IsJavaScriptWhitespace(runes[right]) {
			right++
		}
		builder.WriteString(string(runes[start:left]))
		builder.WriteByte(' ')
		start = right
		index = right - 1
	}
	builder.WriteString(string(runes[start:]))
	return document.Trim(builder.String())
}

func blankToNull(value *string) (*string, bool) {
	if value == nil {
		return nil, false
	}
	trimmed := document.Trim(*value)
	if trimmed == "" || trimmed == "none" {
		return nil, true
	}
	return &trimmed, true
}

func (service *Service) loadRawQuestions(ctx context.Context, directory Directory) ([]storedQuestion, error) {
	names, err := questionFileNames(directory)
	if err != nil || names == nil {
		return nil, err
	}
	questions := []storedQuestion{}
	for _, name := range names {
		if !strings.HasSuffix(name, ".md") {
			continue
		}
		path := filepath.Join(directory.Dir, "questions", name)
		question, readErr := service.readQuestionLocked(ctx, path, strings.TrimSuffix(name, ".md"))
		if readErr != nil {
			if errors.Is(readErr, context.Canceled) || errors.Is(readErr, context.DeadlineExceeded) {
				return nil, readErr
			}
			continue
		}
		questions = append(questions, question)
	}
	return questions, nil
}

func (service *Service) readQuestionLocked(ctx context.Context, path string, stem string) (storedQuestion, error) {
	unlock, err := fsutil.Lock(ctx, path)
	if err != nil {
		return storedQuestion{}, err
	}
	defer unlock()
	return service.readQuestion(path, stem)
}

func (service *Service) readExisting(path string, id string) (storedQuestion, error) {
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return storedQuestion{}, questionNotFound(id)
		}
		return storedQuestion{}, err
	}
	return service.readQuestion(path, id)
}

func (service *Service) readQuestion(path string, stem string) (storedQuestion, error) {
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
	parsed, err := service.parseDocument(string(text))
	if err != nil {
		return storedQuestion{}, err
	}
	if parsed.Meta["title"] == "" {
		return storedQuestion{}, failure("invalid question file")
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

func (service *Service) formatQuestion(question storedQuestion) (string, error) {
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
		encoded, err := service.marshalJavaScript(question.Options)
		if err != nil {
			return "", err
		}
		options = string(encoded)
	}
	return service.formatDocument([]document.Field{
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
	trimmed := document.Trim(value)
	if trimmed == "" {
		return []string{}, nil
	}
	parsed, err := parseJSONStringArray(trimmed)
	if err != nil {
		return nil, failure("invalid question file")
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
	names, err := fsutil.ReadDir(filepath.Join(directory.Dir, "questions"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return names, nil
}

func invalidAnswerBy(value string) error {
	return failure(fmt.Sprintf("invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual %s", value))
}

var durationPattern = regexp.MustCompile(`^(\d+)([mhd])$`)

var answerByPattern = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$`)

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

func failure(message string) error {
	kind := failureKind(message)
	if kind == nil {
		return errors.New(message)
	}
	return errs.Wrap(message, kind)
}

func failureKind(message string) error {
	switch {
	case strings.HasPrefix(message, "question not found"), strings.HasPrefix(message, "issue not found"):
		return errs.ErrNotFound
	case message == "Invalid Date", strings.HasPrefix(message, "title is required"), strings.HasPrefix(message, "invalid "):
		return errs.ErrInvalidArgument
	case strings.HasPrefix(message, "duplicate question"):
		return errs.ErrConflict
	default:
		return nil
	}
}

func classify(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, errs.ErrNotFound) || errors.Is(err, errs.ErrInvalidArgument) || errors.Is(err, errs.ErrConflict) {
		return err
	}
	message := err.Error()
	kind := failureKind(message)
	if kind == nil {
		return err
	}
	return errs.Wrap(message, kind)
}
