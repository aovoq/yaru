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

type commentListJSON struct {
	Comments []store.Comment `json:"comments"`
}

type questionListJSON struct {
	Questions []questions.Question `json:"questions"`
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
