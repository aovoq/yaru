// Package store は .yaru の issue と comment を読み書きする。
// 形式は docs/spec/yaru-format.md の「issue」「comment」「event」。
// 時刻と作者は引数で受け取る。JSON は internal/document、パスは internal/workspace を使う。
package store

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/errs"
	"github.com/aovoq/yaru/internal/fsutil"
	"github.com/aovoq/yaru/internal/workspace"
)

// priorities と statuses はファイルに書ける列挙。大文字は受けない。
// 公開は写しを返す関数にする。src/store.ts:17、src/store.ts:119
var issuePriorities = []string{"urgent", "high", "medium", "low"}
var issueStatuses = []string{"backlog", "todo", "in_progress", "done", "canceled"}

// Priorities は優先度の写しを返す。
func Priorities() []string {
	return append([]string{}, issuePriorities...)
}

// Statuses は状態の写しを返す。
func Statuses() []string {
	return append([]string{}, issueStatuses...)
}

const (
	ListLimitDefault = 50
	ListLimitMax     = 250
)

// Optional は TS の `T | null | undefined` に当たる。Set が false なら渡していない。
// Set が true で Value が nil なら null。src/store.ts:63-96
type Optional[T any] struct {
	Set   bool
	Value *T
}

// Present は値を渡したことを表す。
func Present[T any](value T) Optional[T] {
	return Optional[T]{Set: true, Value: &value}
}

// Null は null を渡したことを表す。
func Null[T any]() Optional[T] {
	return Optional[T]{Set: true}
}

// Issue は 1 件の課題。blockedBy、children、stale はファイルに書かない。
// src/store.ts:20-44、docs/spec/yaru-format.md の「issue」。
type Issue struct {
	ID          string
	Title       string
	Status      string
	Assignee    *string
	Labels      []string
	DueDate     *string
	Priority    *string
	Parent      *string
	Blocks      []string
	BlockedBy   []string
	Children    []string
	StartedAt   *string
	CompletedAt *string
	CanceledAt  *string
	CreatedAt   string
	UpdatedAt   string
	Session     *string
	Worktree    *string
	Branch      *string
	Stale       bool
	Body        string
}

// Provenance は CLI が保存した場所。画面からの保存は渡さず、前の値を残す。
// src/provenance.ts:6-13、src/store.ts:48-51
type Provenance struct {
	Session  *string
	Worktree *string
	Branch   *string
}

// SaveOptions は保存の出どころ、時刻、作者。Now がゼロ値でも clock.Now は呼ばない。
// 作者は assignee の me と、イベントの by に使う。呼び出し側が git の user.name を解決して渡す。
// src/store.ts:48-51、src/store.ts:464-468、docs/spec/yaru-format.md の「git の名前」
type SaveOptions struct {
	Provenance *Provenance
	Now        time.Time
	Author     string
}

// SaveInput は作成と更新の入力。空の ID は作成。src/store.ts:80-96
type SaveInput struct {
	ID              string
	Title           Optional[string]
	Status          Optional[string]
	Assignee        Optional[string]
	Labels          Optional[[]string]
	DueDate         Optional[string]
	Priority        Optional[string]
	Parent          Optional[string]
	Blocks          Optional[[]string]
	AddBlocks       Optional[[]string]
	RemoveBlocks    Optional[[]string]
	AddBlockedBy    Optional[[]string]
	RemoveBlockedBy Optional[[]string]
	Body            Optional[string]
	PatchSet        bool
	Patch           any
}

// Filter は listIssues の絞り込み。Set が false の項目は条件にしない。src/store.ts:63-70
type Filter struct {
	Status   Optional[string]
	Assignee Optional[string]
	Label    Optional[string]
	Query    Optional[string]
	Due      Optional[string]
	Parent   Optional[string]
}

type issueResolvedFilter struct {
	status      string
	statusSet   bool
	assignee    *string
	assigneeSet bool
	label       string
	labelSet    bool
	query       string
	querySet    bool
	dueOverdue  bool
	parent      *string
	parentSet   bool
}

// IssuePage は list の 1 ページ。次が無いとき Cursor は nil。src/store.ts:108-112
type IssuePage struct {
	Issues      []Issue
	HasNextPage bool
	Cursor      *string
}

// PageOptions の Limit が nil なら 50。Cursor が nil なら先頭から。src/store.ts:213-216
type PageOptions struct {
	Limit  any
	Cursor *string
}

var issueNumericMarkdownPattern = regexp.MustCompile(`^(\d+)\.md$`)

// BlankToNull は空と文字列 none を null にする。undefined はそのまま。src/store.ts:400-406
func BlankToNull(value Optional[string]) Optional[string] {
	if !value.Set {
		return Optional[string]{}
	}
	if value.Value == nil {
		return Null[string]()
	}
	trimmed := document.Trim(*value.Value)
	if trimmed == "" || trimmed == "none" {
		return Null[string]()
	}
	return Present(trimmed)
}

// ResolvePriority は none と空を null にし、列挙の外を拒む。src/store.ts:423-429
func ResolvePriority(value Optional[string]) (Optional[string], error) {
	resolved := BlankToNull(value)
	if !resolved.Set || resolved.Value == nil {
		return resolved, nil
	}
	for _, priority := range Priorities() {
		if priority == *resolved.Value {
			return resolved, nil
		}
	}
	return Optional[string]{}, issueErrString("invalid priority: expected " + JoinOr(Priorities()) + ", actual " + issueOriginalString(value))
}

// JoinOr は 3 つ以上のとき最後の前だけ ", or " にする。src/store.ts:450-453
func JoinOr(items []string) string {
	if len(items) <= 2 {
		return strings.Join(items, " or ")
	}
	return strings.Join(items[:len(items)-1], ", ") + ", or " + items[len(items)-1]
}

// ResolveLimit は 1 から 250 の整数だけを受ける。nil は 50。src/store.ts:440-447
func ResolveLimit(value any) (int, error) {
	if value == nil {
		return ListLimitDefault, nil
	}
	number, ok := issueAsFloat(value)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number != math.Trunc(number) || number < 1 || number > ListLimitMax {
		return 0, issueErrString(fmt.Sprintf("invalid limit: expected an integer from 1 to %d, actual %s", ListLimitMax, issueFormatLimitActual(value)))
	}
	return int(number), nil
}

// ListIssues は issues 直下の .md を読み、壊れたファイルは省く。
// 並びは updatedAt の降順、同じなら id の文字の降順。src/store.ts:177-211
// assignee が me のファイルは author に置き換える。src/store.ts:408-411
func ListIssues(ctx context.Context, space workspace.Workspace, filter Filter, now time.Time, author string) ([]Issue, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resolved, err := issueResolveListFilter(filter, author)
	if err != nil {
		return nil, err
	}
	issues, err := loadRawIssues(space, author)
	if err != nil {
		return nil, err
	}
	staleAfter, err := ReadStaleAfter(ctx, space)
	if err != nil {
		return nil, err
	}
	derived := issueWithDerived(issues, now, staleAfter)
	sortIssuesForList(derived)
	matched := []Issue{}
	for _, issue := range derived {
		if issueMatches(issue, resolved, now) {
			matched = append(matched, issue)
		}
	}
	return matched, nil
}

// PageIssues は既に絞った並びを limit と cursor で切る。src/store.ts:213-234
func PageIssues(issues []Issue, options PageOptions) (IssuePage, error) {
	limit, err := ResolveLimit(options.Limit)
	if err != nil {
		return IssuePage{}, err
	}
	start := 0
	if options.Cursor != nil {
		index := -1
		for cursorIndex, issue := range issues {
			if issue.ID == *options.Cursor {
				index = cursorIndex
				break
			}
		}
		if index < 0 {
			return IssuePage{}, issueErrString("cursor not found: expected an issue id from a previous list page, actual " + *options.Cursor)
		}
		start = index + 1
	}
	end := start + limit
	if end > len(issues) {
		end = len(issues)
	}
	page := append([]Issue{}, issues[start:end]...)
	if page == nil {
		page = []Issue{}
	}
	result := IssuePage{Issues: page, HasNextPage: start+limit < len(issues)}
	if result.HasNextPage && len(page) > 0 {
		result.Cursor = issueStringPointer(page[len(page)-1].ID)
	}
	return result, nil
}

// GetIssue は 1 件を読む。壊れていればエラーにし、一覧のように省かない。src/store.ts:236-246
// assignee が me のファイルは author に置き換える。src/store.ts:408-411
func GetIssue(ctx context.Context, space workspace.Workspace, issueID string, now time.Time, author string) (Issue, error) {
	if err := ctx.Err(); err != nil {
		return Issue{}, err
	}
	staleAfter, err := ReadStaleAfter(ctx, space)
	if err != nil {
		return Issue{}, err
	}
	return readDerivedIssue(space, issueID, now, staleAfter, author)
}

func readDerivedIssue(space workspace.Workspace, issueID string, now time.Time, staleAfter int64, author string) (Issue, error) {
	path := issuePath(space, issueID)
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return Issue{}, issueErrString("issue not found: " + issueID)
		}
		return Issue{}, err
	}
	issue, err := readIssue(path, issueID, author)
	if err != nil {
		return Issue{}, err
	}
	others, err := loadRawIssues(space, author)
	if err != nil {
		return Issue{}, err
	}
	rows := make([]Issue, 0, len(others)+1)
	for _, other := range others {
		if other.ID != issueID {
			rows = append(rows, other)
		}
	}
	rows = append(rows, issue)
	for _, row := range issueWithDerived(rows, now, staleAfter) {
		if row.ID == issueID {
			return row, nil
		}
	}
	return Issue{}, issueErrString("issue not found: " + issueID)
}

func issueWithDerived(issues []Issue, now time.Time, staleAfter int64) []Issue {
	derived := make([]Issue, len(issues))
	for index, issue := range issues {
		blockedBy := []string{}
		children := []string{}
		for _, other := range issues {
			if issueContainsString(other.Blocks, issue.ID) {
				blockedBy = append(blockedBy, other.ID)
			}
			if other.Parent != nil && *other.Parent == issue.ID {
				children = append(children, other.ID)
			}
		}
		issue.BlockedBy = blockedBy
		issue.Children = children
		issue.Stale = IsIssueStale(issue.Status, issue.UpdatedAt, now, staleAfter)
		derived[index] = issue
	}
	return derived
}

func loadRawIssues(space workspace.Workspace, author string) ([]Issue, error) {
	directory := filepath.Join(space.Directory, "issues")
	names, err := fsutil.ReadDir(directory)
	if err != nil {
		if os.IsNotExist(err) {
			return []Issue{}, nil
		}
		return nil, err
	}
	issues := []Issue{}
	for _, name := range names {
		if !strings.HasSuffix(name, ".md") {
			continue
		}
		issue, readErr := readIssue(filepath.Join(directory, name), strings.TrimSuffix(name, ".md"), author)
		if readErr != nil {
			continue
		}
		issues = append(issues, issue)
	}
	return issues, nil
}

func readIssue(path string, stem string, author string) (Issue, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Issue{}, err
	}
	issue, err := parseIssue(string(content), author)
	if err != nil {
		return Issue{}, err
	}
	issue.ID = stem
	return issue, nil
}

func parseIssue(text string, author string) (Issue, error) {
	parsed, err := document.Parse(text)
	if err != nil {
		return Issue{}, err
	}
	meta := parsed.Meta
	statusText := issueMetaString(meta, "status")
	if statusText == "" {
		statusText = "todo"
	}
	status, err := issueResolveStatus(statusText)
	if err != nil {
		return Issue{}, err
	}
	assignee, err := issueResolveAssigneeString(issueMetaString(meta, "assignee"), author)
	if err != nil {
		return Issue{}, err
	}
	dueDate, err := issueResolveDueDate(Present(issueMetaString(meta, "dueDate")))
	if err != nil {
		return Issue{}, err
	}
	priority, err := ResolvePriority(Present(issueMetaString(meta, "priority")))
	if err != nil {
		return Issue{}, err
	}
	issue := Issue{
		ID:          issueMetaString(meta, "id"),
		Title:       issueMetaString(meta, "title"),
		Status:      status,
		Assignee:    assignee,
		Labels:      issueParseLabels(issueMetaString(meta, "labels")),
		DueDate:     dueDate.Value,
		Priority:    priority.Value,
		Parent:      issueBlankString(issueMetaString(meta, "parent")),
		Blocks:      issueParseIDList(issueMetaString(meta, "blocks")),
		BlockedBy:   []string{},
		Children:    []string{},
		StartedAt:   issueBlankString(issueMetaString(meta, "startedAt")),
		CompletedAt: issueBlankString(issueMetaString(meta, "completedAt")),
		CanceledAt:  issueBlankString(issueMetaString(meta, "canceledAt")),
		CreatedAt:   issueMetaString(meta, "createdAt"),
		UpdatedAt:   issueMetaString(meta, "updatedAt"),
		Session:     issueBlankString(issueMetaString(meta, "session")),
		Worktree:    issueBlankString(issueMetaString(meta, "worktree")),
		Branch:      issueBlankString(issueMetaString(meta, "branch")),
		Body:        parsed.Body,
	}
	return issue, nil
}

func formatIssue(issue Issue) string {
	return document.Format([]document.Field{
		{Key: "id", Value: issue.ID},
		{Key: "title", Value: strings.ReplaceAll(issue.Title, "\n", " ")},
		{Key: "status", Value: issue.Status},
		{Key: "assignee", Value: issueValueOrEmpty(issue.Assignee)},
		{Key: "labels", Value: strings.Join(issue.Labels, ", ")},
		{Key: "dueDate", Value: issueValueOrEmpty(issue.DueDate)},
		{Key: "priority", Value: issueValueOrEmpty(issue.Priority)},
		{Key: "parent", Value: issueValueOrEmpty(issue.Parent)},
		{Key: "blocks", Value: strings.Join(issue.Blocks, ", ")},
		{Key: "startedAt", Value: issueValueOrEmpty(issue.StartedAt)},
		{Key: "completedAt", Value: issueValueOrEmpty(issue.CompletedAt)},
		{Key: "canceledAt", Value: issueValueOrEmpty(issue.CanceledAt)},
		{Key: "createdAt", Value: issue.CreatedAt},
		{Key: "updatedAt", Value: issue.UpdatedAt},
		{Key: "session", Value: issueValueOrEmpty(issue.Session)},
		{Key: "worktree", Value: issueValueOrEmpty(issue.Worktree)},
		{Key: "branch", Value: issueValueOrEmpty(issue.Branch)},
	}, issue.Body)
}

func issueResolveListFilter(filter Filter, author string) (issueResolvedFilter, error) {
	resolved := issueResolvedFilter{}
	if filter.Status.Set {
		text := ""
		if filter.Status.Value != nil {
			text = *filter.Status.Value
		}
		status, err := issueResolveStatus(text)
		if err != nil {
			return issueResolvedFilter{}, err
		}
		resolved.status = status
		resolved.statusSet = true
	}
	if filter.Assignee.Set {
		assignee, err := issueResolveAssignee(filter.Assignee, author)
		if err != nil {
			return issueResolvedFilter{}, err
		}
		resolved.assignee = assignee.Value
		resolved.assigneeSet = true
	}
	if filter.Label.Set && filter.Label.Value != nil && *filter.Label.Value != "" {
		resolved.label = *filter.Label.Value
		resolved.labelSet = true
	}
	if filter.Query.Set && filter.Query.Value != nil && *filter.Query.Value != "" {
		resolved.query = strings.ToLower(*filter.Query.Value)
		resolved.querySet = true
	}
	if filter.Due.Set && filter.Due.Value != nil && *filter.Due.Value == "overdue" {
		resolved.dueOverdue = true
	}
	if filter.Parent.Set {
		if filter.Parent.Value != nil && *filter.Parent.Value != "none" {
			resolved.parent = issueStringPointer(*filter.Parent.Value)
		}
		resolved.parentSet = true
	}
	return resolved, nil
}

func issueMatches(issue Issue, filter issueResolvedFilter, now time.Time) bool {
	if filter.statusSet && issue.Status != filter.status {
		return false
	}
	if filter.assigneeSet && !issueSameOptionalString(issue.Assignee, filter.assignee) {
		return false
	}
	if filter.labelSet && !issueContainsString(issue.Labels, filter.label) {
		return false
	}
	if filter.querySet {
		haystack := strings.ToLower(issue.ID + " " + issue.Title + " " + issue.Body)
		if !strings.Contains(haystack, filter.query) {
			return false
		}
	}
	if filter.dueOverdue && !IsIssueOverdue(issue.DueDate, issue.Status, now) {
		return false
	}
	if filter.parentSet && !issueSameOptionalString(issue.Parent, filter.parent) {
		return false
	}
	return true
}

func issueResolveStatus(value string) (string, error) {
	trimmed := document.Trim(value)
	for _, status := range Statuses() {
		if status == trimmed {
			return trimmed, nil
		}
	}
	return "", issueErrString("invalid status: expected " + JoinOr(Statuses()) + ", actual " + value)
}

func issueResolveDueDate(value Optional[string]) (Optional[string], error) {
	resolved := BlankToNull(value)
	if !resolved.Set || resolved.Value == nil {
		return resolved, nil
	}
	if !issueIsCalendarDate(*resolved.Value) {
		return Optional[string]{}, issueErrString("invalid dueDate: expected YYYY-MM-DD, actual " + issueOriginalString(value))
	}
	return resolved, nil
}

func issueResolveAssignee(value Optional[string], author string) (Optional[string], error) {
	resolved := BlankToNull(value)
	if resolved.Set && resolved.Value != nil && *resolved.Value == "me" {
		return Present(author), nil
	}
	return resolved, nil
}

func issueResolveAssigneeString(value string, author string) (*string, error) {
	resolved, err := issueResolveAssignee(Present(value), author)
	if err != nil {
		return nil, err
	}
	return resolved.Value, nil
}

func nextIssueID(space workspace.Workspace) (string, error) {
	names, err := fsutil.ReadDir(filepath.Join(space.Directory, "issues"))
	if err != nil {
		if os.IsNotExist(err) {
			return "1", nil
		}
		return "", err
	}
	maximum := 0.0
	for _, name := range names {
		matches := issueNumericMarkdownPattern.FindStringSubmatch(name)
		if matches == nil {
			continue
		}
		number, ok := document.ParseNumber(matches[1])
		if !ok || number <= maximum {
			continue
		}
		maximum = number
	}
	return document.FormatNumber(maximum + 1), nil
}

func issueWriteCreate(path string, text string) error {
	return fsutil.WriteCreate(path, text)
}

func issueWriteReplace(path string, text string) error {
	return fsutil.WriteReplace(path, text)
}

func issuePath(space workspace.Workspace, issueID string) string {
	return filepath.Join(space.Directory, "issues", issueID+".md")
}

func issueParseLabels(raw string) []string {
	labels := []string{}
	if raw == "" {
		return labels
	}
	for _, part := range strings.Split(raw, ",") {
		part = document.Trim(part)
		if part == "" {
			continue
		}
		labels = append(labels, part)
	}
	return labels
}

func issueParseIDList(raw string) []string {
	return issueUniqueStrings(issueParseLabels(raw))
}

func issueBlankString(value string) *string {
	return BlankToNull(Present(value)).Value
}

func issueOriginalString(value Optional[string]) string {
	if value.Value == nil {
		return "null"
	}
	return *value.Value
}

func issueIsoTimestamp(moment time.Time) string {
	return clock.ISOString(moment)
}

func issueFormatLimitActual(value any) string {
	number, ok := issueAsFloat(value)
	if !ok {
		return fmt.Sprint(value)
	}
	return document.FormatNumber(number)
}

func issueAsFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case int:
		return float64(typed), true
	case int8:
		return float64(typed), true
	case int16:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint8:
		return float64(typed), true
	case uint16:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case float32:
		return float64(typed), true
	case float64:
		return typed, true
	default:
		return 0, false
	}
}

func issueStringPointer(value string) *string {
	copied := value
	return &copied
}

func issueValueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func issueCopyStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string{}, values...)
}

func issueSameStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func issueSameOptionalString(left *string, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func issueContainsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func issueUniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := []string{}
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func issueMetaString(meta map[string]string, key string) string {
	if meta == nil {
		return ""
	}
	return meta[key]
}

// issueErrString は Error() の文字列を message のままにし、サーバー向けの種類を付ける。
// not found を含むものは ErrNotFound。invalid、required、cannot pass、patch is only valid は ErrInvalidArgument。
// それ以外の cannot で状態が衝突するものは ErrConflict。src/store.ts のエラー文言。
func issueErrString(message string) error {
	return errs.Wrap(message, issueErrorKind(message))
}

func issueErrorKind(message string) error {
	if strings.Contains(message, "not found") {
		return errs.ErrNotFound
	}
	if strings.Contains(message, "invalid") || strings.Contains(message, "required") || strings.Contains(message, "cannot pass") || strings.Contains(message, "patch is only valid") {
		return errs.ErrInvalidArgument
	}
	if strings.Contains(message, "cannot ") {
		return errs.ErrConflict
	}
	return errs.ErrInvalidArgument
}

func issueIsExist(err error) bool {
	return err != nil && os.IsExist(err)
}
