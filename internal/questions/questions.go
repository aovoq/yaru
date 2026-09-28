// 質問の読み書き。TS 版の src/questions.ts
// status はファイルに書かず、読むときに answerBy と今から決める。JSON では最後のフィールドになる
// 仕様は docs/spec/yaru-format.md
package questions

import (
	"github.com/aovoq/yaru/internal/provenance"
	"github.com/aovoq/yaru/internal/workspace"
)

// Question の JSON の並びは、保存したオブジェクトに status を後ろから足した順 (src/questions.ts の withStatus)
// スナップショット question-save-answer の並びと同じ
type Question struct {
	ID                 string   `json:"id"`
	Title              string   `json:"title"`
	Issue              *string  `json:"issue"`
	Priority           *string  `json:"priority"`
	DefaultAction      *string  `json:"defaultAction"`
	AnswerBy           *string  `json:"answerBy"`
	Options            []string `json:"options"`
	Author             string   `json:"author"`
	Session            *string  `json:"session"`
	Worktree           *string  `json:"worktree"`
	Branch             *string  `json:"branch"`
	Answer             *string  `json:"answer"`
	AnsweredBy         *string  `json:"answeredBy"`
	AnsweredAt         *string  `json:"answeredAt"`
	AcknowledgedAt     *string  `json:"acknowledgedAt"`
	NotifiedExpiringAt *string  `json:"notifiedExpiringAt"`
	CanceledAt         *string  `json:"canceledAt"`
	CreatedAt          string   `json:"createdAt"`
	UpdatedAt          string   `json:"updatedAt"`
	Body               string   `json:"body"`
	Status             string   `json:"status"`
}

// Filter は src/questions.ts:112-115。ポインタが nil ならその項目では絞り込まない
type Filter struct {
	Status *string
	Issue  *string
}

// SaveInput は src/questions.ts:60-75
// OptionsSet が false なら選択肢は変えない。true かつ Options が nil なら消す (--option none)
// Provenance は作成のときだけ渡す
type SaveInput struct {
	ID            *string
	Title         *string
	Issue         *string
	Priority      *string
	DefaultAction *string
	AnswerBy      *string
	Options       []string
	OptionsSet    bool
	Status        *string
	Body          *string
	Provenance    *provenance.Provenance
	Force         bool
}

// AnswerInput は src/questions.ts:77-83。CLI は expectedStatus を渡さない
type AnswerInput struct {
	Body  *string
	Force bool
}

// EnsureDirectory は src/questions.ts:606 の ensureQuestionsDirectory。init のあとで questions/.gitignore を作る
func EnsureDirectory(opened workspace.Workspace) error {
	panic("not implemented: questions.EnsureDirectory")
}

// List は src/questions.ts:387 の listQuestions
func List(opened workspace.Workspace, filter Filter) ([]Question, error) {
	panic("not implemented: questions.List")
}

// Get は src/questions.ts:381 の getQuestion。acknowledgedAt は書かない
func Get(opened workspace.Workspace, questionID string) (Question, error) {
	panic("not implemented: questions.Get")
}

// Acknowledge は src/questions.ts:348 の acknowledgeQuestion。question get と、wait の最後で使う
func Acknowledge(opened workspace.Workspace, questionID string) (Question, error) {
	panic("not implemented: questions.Acknowledge")
}

// Save は src/questions.ts:119 の saveQuestion
func Save(opened workspace.Workspace, input SaveInput) (Question, error) {
	panic("not implemented: questions.Save")
}

// Answer は src/questions.ts:195 の answerQuestion
func Answer(opened workspace.Workspace, questionID string, input AnswerInput) (Question, error) {
	panic("not implemented: questions.Answer")
}
