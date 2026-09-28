// issue と comment の読み書き。TS 版の src/store.ts
// 一覧のページングと、保存時の検証 (status、priority、limit) もここが返す。CLI は文言を足さない
// 仕様は docs/spec/yaru-format.md
package store

import (
	"github.com/aovoq/yaru/internal/provenance"
	"github.com/aovoq/yaru/internal/workspace"
)

// ListLimitDefault と ListLimitMaximum は src/store.ts:105-106
const (
	ListLimitDefault = 50
	ListLimitMaximum = 250
)

// Issue の JSON の並びは src/store.ts:20-44 のオブジェクト順。nil は null、空の slice は []
// cursor の無いページはフィールド自体を出さないので、ページ側で omitempty にする
type Issue struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Status      string   `json:"status"`
	Assignee    *string  `json:"assignee"`
	Labels      []string `json:"labels"`
	DueDate     *string  `json:"dueDate"`
	Priority    *string  `json:"priority"`
	Parent      *string  `json:"parent"`
	Blocks      []string `json:"blocks"`
	BlockedBy   []string `json:"blockedBy"`
	Children    []string `json:"children"`
	StartedAt   *string  `json:"startedAt"`
	CompletedAt *string  `json:"completedAt"`
	CanceledAt  *string  `json:"canceledAt"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
	Session     *string  `json:"session"`
	Worktree    *string  `json:"worktree"`
	Branch      *string  `json:"branch"`
	Stale       bool     `json:"stale"`
	Body        string   `json:"body"`
}

// Comment の JSON の並びは src/store.ts:53-61
type Comment struct {
	ID        string  `json:"id"`
	Issue     string  `json:"issue"`
	Parent    *string `json:"parent"`
	Author    string  `json:"author"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
	Body      string  `json:"body"`
}

// Filter は src/store.ts:63-70。ポインタが nil の項目は絞り込まない
// ParentSet が true かつ Parent が nil のときは、親が無い issue (CLI が --parent none を null にしたもの)
type Filter struct {
	Status    *string
	Assignee  *string
	Label     *string
	Query     *string
	Due       *string
	ParentSet bool
	Parent    *string
}

// IssuePage は src/store.ts:108-112。次が無いときは Cursor を nil にしてフィールドを出さない
type IssuePage struct {
	Issues      []Issue `json:"issues"`
	HasNextPage bool    `json:"hasNextPage"`
	Cursor      *string `json:"cursor,omitempty"`
}

// SaveInput は src/store.ts:80-96。ポインタが nil の項目は「渡していない」
// LabelsSet が false ならラベルは変えない。PatchSet が false なら patch は無い
// Patch は JSON.parse の結果。配列は []any、オブジェクトは map[string]any、数は float64
type SaveInput struct {
	ID              *string
	Title           *string
	Status          *string
	Assignee        *string
	Labels          []string
	LabelsSet       bool
	DueDate         *string
	Priority        *string
	Parent          *string
	AddBlocks       []string
	RemoveBlocks    []string
	AddBlockedBy    []string
	RemoveBlockedBy []string
	Body            *string
	Patch           any
	PatchSet        bool
}

// SaveOptions は src/store.ts:48-51。Provenance は CLI が動かしたディレクトリから読む
type SaveOptions struct {
	Provenance *provenance.Provenance
}

// SaveCommentInput は src/store.ts:98-103。ポインタが nil ならその項目は渡していない
type SaveCommentInput struct {
	ID     *string
	Issue  *string
	Parent *string
	Body   *string
}

// List は src/store.ts:202 の listIssues
func List(opened workspace.Workspace, filter Filter) ([]Issue, error) {
	panic("not implemented: store.List")
}

// Page は src/store.ts:213 の pageIssues。limit が nil なら既定の 50。範囲外は error
// cursor が nil でなければ、その id の次から。見つからなければ error
func Page(issues []Issue, limit *int, cursor *string) (IssuePage, error) {
	panic("not implemented: store.Page")
}

// Get は src/store.ts:236 の getIssue
func Get(opened workspace.Workspace, issueID string) (Issue, error) {
	panic("not implemented: store.Get")
}

// Save は src/store.ts:248 の saveIssue
func Save(opened workspace.Workspace, input SaveInput, options SaveOptions) (Issue, error) {
	panic("not implemented: store.Save")
}

// ListComments は src/store.ts:648 の listComments
func ListComments(opened workspace.Workspace, issueID string) ([]Comment, error) {
	panic("not implemented: store.ListComments")
}

// GetComment は src/store.ts:655 の getComment
func GetComment(opened workspace.Workspace, commentID string) (Comment, error) {
	panic("not implemented: store.GetComment")
}

// SaveComment は src/store.ts:661 の saveComment
func SaveComment(opened workspace.Workspace, input SaveCommentInput) (Comment, error) {
	panic("not implemented: store.SaveComment")
}
