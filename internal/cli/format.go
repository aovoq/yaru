//declscope:namespace cli

// 人向けの出力と、JSON.stringify(value, null, 2) と同じ整形
// バイト列の中身は document.MarshalJavaScript に任せ、ここでは空白だけを足す
package cli

import (
	"fmt"
	"io"
	"strings"
	"unicode/utf16"

	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/store"
)

func humanRequested(parsed parsedArguments) bool {
	return truthyFlag(parsed, "format") || truthyFlag(parsed, "f")
}

func printJSON(stdout io.Writer, value any) error {
	compact, err := document.MarshalJavaScript(value)
	if err != nil {
		return err
	}
	pretty, err := prettyJavaScriptJSON(compact)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "%s\n", pretty)
	return err
}

type issueWire struct {
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

type issuePageWire struct {
	Issues      []issueWire `json:"issues"`
	HasNextPage bool        `json:"hasNextPage"`
	Cursor      *string     `json:"cursor,omitempty"`
}

type commentWire struct {
	ID        string  `json:"id"`
	Issue     string  `json:"issue"`
	Parent    *string `json:"parent"`
	Author    string  `json:"author"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
	Body      string  `json:"body"`
}

type commentListWire struct {
	Comments []commentWire `json:"comments"`
}

// questionWire の status は最後。src/questions.ts の withStatus が後ろから足す並び
type questionWire struct {
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

type questionListWire struct {
	Questions []questionWire `json:"questions"`
}

func wireIssue(issue store.Issue) issueWire {
	return issueWire{
		ID: issue.ID, Title: issue.Title, Status: issue.Status, Assignee: issue.Assignee,
		Labels: nonNilStrings(issue.Labels), DueDate: issue.DueDate, Priority: issue.Priority, Parent: issue.Parent,
		Blocks: nonNilStrings(issue.Blocks), BlockedBy: nonNilStrings(issue.BlockedBy), Children: nonNilStrings(issue.Children),
		StartedAt: issue.StartedAt, CompletedAt: issue.CompletedAt, CanceledAt: issue.CanceledAt,
		CreatedAt: issue.CreatedAt, UpdatedAt: issue.UpdatedAt, Session: issue.Session, Worktree: issue.Worktree,
		Branch: issue.Branch, Stale: issue.Stale, Body: issue.Body,
	}
}

func wireIssuePage(page store.IssuePage) issuePageWire {
	issues := make([]issueWire, 0, len(page.Issues))
	for _, issue := range page.Issues {
		issues = append(issues, wireIssue(issue))
	}
	return issuePageWire{Issues: issues, HasNextPage: page.HasNextPage, Cursor: page.Cursor}
}

func wireComment(comment store.Comment) commentWire {
	return commentWire{
		ID: comment.ID, Issue: comment.Issue, Parent: comment.Parent, Author: comment.Author,
		CreatedAt: comment.CreatedAt, UpdatedAt: comment.UpdatedAt, Body: comment.Body,
	}
}

func wireComments(comments []store.Comment) commentListWire {
	values := make([]commentWire, 0, len(comments))
	for _, comment := range comments {
		values = append(values, wireComment(comment))
	}
	return commentListWire{Comments: values}
}

func wireQuestion(question questions.Question) questionWire {
	return questionWire{
		ID: question.ID, Title: question.Title, Issue: question.Issue, Priority: question.Priority,
		DefaultAction: question.DefaultAction, AnswerBy: question.AnswerBy, Options: nonNilStrings(question.Options),
		Author: question.Author, Session: question.Session, Worktree: question.Worktree, Branch: question.Branch,
		Answer: question.Answer, AnsweredBy: question.AnsweredBy, AnsweredAt: question.AnsweredAt,
		AcknowledgedAt: question.AcknowledgedAt, NotifiedExpiringAt: question.NotifiedExpiringAt,
		CanceledAt: question.CanceledAt, CreatedAt: question.CreatedAt, UpdatedAt: question.UpdatedAt,
		Body: question.Body, Status: question.Status,
	}
}

func wireQuestions(questionList []questions.Question) questionListWire {
	values := make([]questionWire, 0, len(questionList))
	for _, question := range questionList {
		values = append(values, wireQuestion(question))
	}
	return questionListWire{Questions: values}
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// formatIssueList は src/index.ts:439-451
func formatIssueList(issues []store.Issue) string {
	if len(issues) == 0 {
		return "(none)\n"
	}
	width := 0
	for _, issue := range issues {
		if length := javaScriptLength(issue.ID); length > width {
			width = length
		}
	}
	var builder strings.Builder
	for _, issue := range issues {
		fmt.Fprintf(&builder, "%s  %s  %s  %s  %s  %s\n",
			padEnd(issue.ID, width),
			padEnd(issue.Status, 12),
			padEnd(orDashIfNull(issue.Assignee), 12),
			padEnd(orDashIfNull(issue.DueDate), 10),
			padEnd(orDashIfNull(issue.Priority), 6),
			issue.Title,
		)
	}
	return builder.String()
}

// formatIssue は src/index.ts:751-759
func formatIssue(issue store.Issue) string {
	text := fmt.Sprintf("%s  %s  %s  %s  %s  %s  parent %s  blocks %s  blockedBy %s\n%s\n\n%s",
		issue.ID,
		issue.Status,
		orDashIfNull(issue.Assignee),
		joinOrDash(issue.Labels),
		orDashIfNull(issue.DueDate),
		orDashIfNull(issue.Priority),
		orDashIfNull(issue.Parent),
		joinOrDash(issue.Blocks),
		joinOrDash(issue.BlockedBy),
		issue.Title,
		issue.Body,
	)
	if issue.Body != "" {
		text += "\n"
	}
	return text
}

// formatCommentList は src/index.ts:515-522。本文は最初の行だけ
func formatCommentList(comments []store.Comment) string {
	if len(comments) == 0 {
		return "(none)\n"
	}
	var builder strings.Builder
	for _, comment := range comments {
		firstLine, _, _ := strings.Cut(comment.Body, "\n")
		fmt.Fprintf(&builder, "%s  %s  %s\n", comment.ID, comment.Author, firstLine)
	}
	return builder.String()
}

// formatComment は src/index.ts:761-764
func formatComment(comment store.Comment) string {
	text := fmt.Sprintf("%s  %s  %s  %s\n%s", comment.ID, comment.Issue, orDashIfNull(comment.Parent), comment.Author, comment.Body)
	if comment.Body != "" {
		text += "\n"
	}
	return text
}

// formatQuestionList は src/index.ts:573-581
func formatQuestionList(questionList []questions.Question) string {
	if len(questionList) == 0 {
		return "(none)\n"
	}
	width := 0
	for _, question := range questionList {
		if length := javaScriptLength(question.ID); length > width {
			width = length
		}
	}
	var builder strings.Builder
	for _, question := range questionList {
		fmt.Fprintf(&builder, "%s  %s  %s  %s  %s\n",
			padEnd(question.ID, width),
			padEnd(question.Status, 8),
			padEnd(orDashIfNull(question.Priority), 6),
			padEnd(orDashIfNull(question.AnswerBy), 24),
			question.Title,
		)
	}
	return builder.String()
}

// formatQuestion は src/index.ts:681-701
func formatQuestion(question questions.Question) string {
	lines := []string{
		fmt.Sprintf("%s  %s  %s  issue %s  answerBy %s", question.ID, question.Status, orDashIfNull(question.Priority), orDashIfNull(question.Issue), orDashIfNull(question.AnswerBy)),
		question.Title,
	}
	if truthyString(question.DefaultAction) {
		lines = append(lines, "default: "+*question.DefaultAction)
	}
	for _, option := range question.Options {
		lines = append(lines, "option: "+option)
	}
	if truthyString(question.Branch) || truthyString(question.Worktree) || truthyString(question.Session) {
		lines = append(lines, fmt.Sprintf("asked from: %s  %s  session %s", orDashIfNull(question.Branch), orDashIfNull(question.Worktree), orDashIfNull(question.Session)))
	}
	if truthyString(&question.Body) {
		lines = append(lines, "", question.Body)
	}
	if question.Answer != nil {
		lines = append(lines, "", fmt.Sprintf("answer (%s %s, picked up %s):", orDashIfNull(question.AnsweredBy), orDashIfNull(question.AnsweredAt), orDashIfNull(question.AcknowledgedAt)), *question.Answer)
	}
	return strings.Join(lines, "\n") + "\n"
}

// formatWaitResult は src/index.ts:704-709
func formatWaitResult(question questions.Question) string {
	if question.Status == "answered" {
		answer := "null"
		if question.Answer != nil {
			answer = *question.Answer
		}
		return "answered\n" + answer + "\n"
	}
	if question.Status == "expired" {
		action := "(no default action)"
		if question.DefaultAction != nil {
			action = *question.DefaultAction
		}
		return "expired: proceed with the default action\n" + action + "\n"
	}
	return question.Status + "\n"
}

func orDashIfNull(value *string) string {
	if value == nil {
		return "-"
	}
	return *value
}

func truthyString(value *string) bool {
	return value != nil && *value != ""
}

func joinOrDash(values []string) string {
	if len(values) == 0 {
		return "-"
	}
	return strings.Join(values, ", ")
}

// padEnd は JS の String.prototype.padEnd。長さは UTF-16 の符号単位 (src/index.ts:443)
func padEnd(value string, width int) string {
	length := javaScriptLength(value)
	if length >= width {
		return value
	}
	return value + strings.Repeat(" ", width-length)
}

func javaScriptLength(value string) int {
	return len(utf16.Encode([]rune(value)))
}

// prettyJavaScriptJSON は JSON.stringify(value, null, 2)。空の {} と [] は 1 行のまま
func prettyJavaScriptJSON(compact []byte) (string, error) {
	var builder strings.Builder
	index := 0
	if err := writePrettyValue(&builder, compact, &index, 0); err != nil {
		return "", err
	}
	if index != len(compact) {
		return "", fmt.Errorf("invalid JSON: expected end of value, actual trailing bytes")
	}
	return builder.String(), nil
}

func writePrettyValue(builder *strings.Builder, compact []byte, index *int, indent int) error {
	if *index >= len(compact) {
		return fmt.Errorf("invalid JSON: expected a value, actual end of input")
	}
	switch compact[*index] {
	case '{':
		return writePrettyCollection(builder, compact, index, indent, '{', '}')
	case '[':
		return writePrettyCollection(builder, compact, index, indent, '[', ']')
	case '"':
		return writePrettyString(builder, compact, index)
	default:
		start := *index
		for *index < len(compact) {
			character := compact[*index]
			if character == ',' || character == '}' || character == ']' {
				break
			}
			*index++
		}
		if start == *index {
			return fmt.Errorf("invalid JSON: expected a value, actual %q", compact[*index:])
		}
		builder.Write(compact[start:*index])
		return nil
	}
}

func writePrettyCollection(builder *strings.Builder, compact []byte, index *int, indent int, open byte, close byte) error {
	*index++
	if *index < len(compact) && compact[*index] == close {
		*index++
		builder.WriteByte(open)
		builder.WriteByte(close)
		return nil
	}
	builder.WriteByte(open)
	builder.WriteByte('\n')
	childIndent := indent + 1
	for {
		builder.WriteString(strings.Repeat("  ", childIndent))
		if open == '{' {
			if err := writePrettyString(builder, compact, index); err != nil {
				return err
			}
			if *index >= len(compact) || compact[*index] != ':' {
				return fmt.Errorf("invalid JSON: expected colon, actual end of input")
			}
			*index++
			builder.WriteString(": ")
		}
		if err := writePrettyValue(builder, compact, index, childIndent); err != nil {
			return err
		}
		if *index >= len(compact) {
			return fmt.Errorf("invalid JSON: expected %q, actual end of input", string(close))
		}
		switch compact[*index] {
		case ',':
			*index++
			builder.WriteString(",\n")
		case close:
			*index++
			builder.WriteByte('\n')
			builder.WriteString(strings.Repeat("  ", indent))
			builder.WriteByte(close)
			return nil
		default:
			return fmt.Errorf("invalid JSON: expected comma or %q, actual %q", string(close), string(compact[*index]))
		}
	}
}

func writePrettyString(builder *strings.Builder, compact []byte, index *int) error {
	if *index >= len(compact) || compact[*index] != '"' {
		return fmt.Errorf("invalid JSON: expected a string, actual end of input")
	}
	start := *index
	*index++
	for *index < len(compact) {
		character := compact[*index]
		*index++
		if character == '\\' {
			if *index >= len(compact) {
				return fmt.Errorf("invalid JSON: expected an escape, actual end of input")
			}
			*index++
			continue
		}
		if character == '"' {
			builder.Write(compact[start:*index])
			return nil
		}
	}
	return fmt.Errorf("invalid JSON: expected end of string, actual end of input")
}
