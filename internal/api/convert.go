//declscope:core
package api

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/repository"
	"github.com/aovoq/yaru/internal/sessions"
	"github.com/aovoq/yaru/internal/store"
)

func protoQuestions(listed []questions.Question) ([]*yaruv1.Question, error) {
	converted := []*yaruv1.Question{}
	for _, question := range listed {
		message, err := protoQuestion(question)
		if err != nil {
			return nil, err
		}
		converted = append(converted, message)
	}
	return converted, nil
}

// protoQuestion は読む質問を proto にする。null は optional の未設定。UNSPECIFIED は出さない。
// docs/spec/routes.md の「列挙」と「値が無いことと空」。src/questions.ts:32-58 。
func protoQuestion(question questions.Question) (*yaruv1.Question, error) {
	status, err := questionStatusEnum(question.Status)
	if err != nil {
		return nil, err
	}
	priority, err := protoPriority(question.Priority)
	if err != nil {
		return nil, err
	}
	return &yaruv1.Question{
		Id:                 question.ID,
		Title:              question.Title,
		Status:             status,
		Issue:              copiedString(question.Issue),
		Priority:           priority,
		DefaultAction:      copiedString(question.DefaultAction),
		AnswerBy:           copiedString(question.AnswerBy),
		Options:            copiedStrings(question.Options),
		Author:             question.Author,
		Session:            copiedString(question.Session),
		Worktree:           copiedString(question.Worktree),
		Branch:             copiedString(question.Branch),
		Answer:             copiedString(question.Answer),
		AnsweredBy:         copiedString(question.AnsweredBy),
		AnsweredAt:         copiedString(question.AnsweredAt),
		AcknowledgedAt:     copiedString(question.AcknowledgedAt),
		NotifiedExpiringAt: copiedString(question.NotifiedExpiringAt),
		CanceledAt:         copiedString(question.CanceledAt),
		CreatedAt:          question.CreatedAt,
		UpdatedAt:          question.UpdatedAt,
		Body:               question.Body,
	}, nil
}

func protoIssues(listed []store.Issue) ([]*yaruv1.Issue, error) {
	converted := []*yaruv1.Issue{}
	for _, issue := range listed {
		message, err := protoIssue(issue)
		if err != nil {
			return nil, err
		}
		converted = append(converted, message)
	}
	return converted, nil
}

func protoIssue(issue store.Issue) (*yaruv1.Issue, error) {
	status, err := protoIssueStatus(issue.Status)
	if err != nil {
		return nil, err
	}
	priority, err := protoPriority(issue.Priority)
	if err != nil {
		return nil, err
	}
	return &yaruv1.Issue{
		Id:          issue.ID,
		Title:       issue.Title,
		Status:      status,
		Assignee:    copiedString(issue.Assignee),
		Labels:      copiedStrings(issue.Labels),
		DueDate:     copiedString(issue.DueDate),
		Priority:    priority,
		Parent:      copiedString(issue.Parent),
		Blocks:      copiedStrings(issue.Blocks),
		BlockedBy:   copiedStrings(issue.BlockedBy),
		Children:    copiedStrings(issue.Children),
		StartedAt:   copiedString(issue.StartedAt),
		CompletedAt: copiedString(issue.CompletedAt),
		CanceledAt:  copiedString(issue.CanceledAt),
		CreatedAt:   issue.CreatedAt,
		UpdatedAt:   issue.UpdatedAt,
		Session:     copiedString(issue.Session),
		Worktree:    copiedString(issue.Worktree),
		Branch:      copiedString(issue.Branch),
		Stale:       issue.Stale,
		Body:        issue.Body,
	}, nil
}

func protoSessionHealth(health sessions.Health) (*yaruv1.SessionHealth, error) {
	windowDays, err := fitInt32(health.WindowDays, "windowDays")
	if err != nil {
		return nil, err
	}
	summaries := []*yaruv1.SessionSummary{}
	for _, session := range health.Sessions {
		converted, convertErr := protoSession(session)
		if convertErr != nil {
			return nil, convertErr
		}
		summaries = append(summaries, converted)
	}
	totals, err := protoTotals(health.Totals)
	if err != nil {
		return nil, err
	}
	return &yaruv1.SessionHealth{
		Directory:  copiedString(health.Directory),
		WindowDays: windowDays,
		Sessions:   summaries,
		Totals:     totals,
	}, nil
}

func protoSession(session sessions.Summary) (*yaruv1.SessionSummary, error) {
	assistantMessages, err := fitInt32(session.AssistantMessages, "assistantMessages")
	if err != nil {
		return nil, err
	}
	unpriced, err := fitInt32(session.UnpricedMessages, "unpricedMessages")
	if err != nil {
		return nil, err
	}
	toolUses, err := fitInt32(session.ToolUses, "toolUses")
	if err != nil {
		return nil, err
	}
	toolResults, err := fitInt32(session.ToolResults, "toolResults")
	if err != nil {
		return nil, err
	}
	toolErrors, err := fitInt32(session.ToolErrors, "toolErrors")
	if err != nil {
		return nil, err
	}
	interruptions, err := fitInt32(session.Interruptions, "interruptions")
	if err != nil {
		return nil, err
	}
	subagents, err := fitInt32(session.Subagents, "subagents")
	if err != nil {
		return nil, err
	}
	return &yaruv1.SessionSummary{
		Id:                  session.ID,
		Worktree:            copiedString(session.Worktree),
		Title:               copiedString(session.Title),
		StartedAt:           copiedString(session.StartedAt),
		LastActivityAt:      copiedString(session.LastActivityAt),
		Models:              copiedStrings(session.Models),
		AssistantMessages:   assistantMessages,
		InputTokens:         tokenFloat(session.InputTokens),
		CacheCreationTokens: tokenFloat(session.CacheCreationTokens),
		CacheReadTokens:     tokenFloat(session.CacheReadTokens),
		OutputTokens:        tokenFloat(session.OutputTokens),
		CostUsd:             session.CostUsd,
		UnpricedMessages:    unpriced,
		ToolUses:            toolUses,
		ToolResults:         toolResults,
		ToolErrors:          toolErrors,
		Interruptions:       interruptions,
		Subagents:           subagents,
	}, nil
}

func protoTotals(totals sessions.Totals) (*yaruv1.SessionTotals, error) {
	sessionsCount, err := fitInt32(totals.Sessions, "sessions")
	if err != nil {
		return nil, err
	}
	unpriced, err := fitInt32(totals.UnpricedMessages, "unpricedMessages")
	if err != nil {
		return nil, err
	}
	assistantMessages, err := fitInt32(totals.AssistantMessages, "assistantMessages")
	if err != nil {
		return nil, err
	}
	toolResults, err := fitInt32(totals.ToolResults, "toolResults")
	if err != nil {
		return nil, err
	}
	toolErrors, err := fitInt32(totals.ToolErrors, "toolErrors")
	if err != nil {
		return nil, err
	}
	interruptions, err := fitInt32(totals.Interruptions, "interruptions")
	if err != nil {
		return nil, err
	}
	return &yaruv1.SessionTotals{
		Sessions:          sessionsCount,
		CostUsd:           totals.CostUsd,
		UnpricedMessages:  unpriced,
		AssistantMessages: assistantMessages,
		CacheReadRatio:    copiedFloat(totals.CacheReadRatio),
		ToolResults:       toolResults,
		ToolErrors:        toolErrors,
		ToolErrorRatio:    copiedFloat(totals.ToolErrorRatio),
		Interruptions:     interruptions,
	}, nil
}

func protoRepository(state *repository.State) (*yaruv1.RepositoryState, error) {
	if state == nil {
		return nil, nil
	}
	ahead, err := copiedInt32(state.Ahead, "ahead")
	if err != nil {
		return nil, err
	}
	behind, err := copiedInt32(state.Behind, "behind")
	if err != nil {
		return nil, err
	}
	uncommitted, err := fitInt32(state.UncommittedFiles, "uncommittedFiles")
	if err != nil {
		return nil, err
	}
	commits := []*yaruv1.RepositoryCommit{}
	for _, commit := range state.Commits {
		commits = append(commits, &yaruv1.RepositoryCommit{
			Hash:        commit.Hash,
			Subject:     commit.Subject,
			Author:      commit.Author,
			CommittedAt: commit.CommittedAt,
			Pushed:      copiedBool(commit.Pushed),
		})
	}
	return &yaruv1.RepositoryState{
		Branch:           copiedString(state.Branch),
		Upstream:         copiedString(state.Upstream),
		Ahead:            ahead,
		Behind:           behind,
		UncommittedFiles: uncommitted,
		Commits:          commits,
	}, nil
}

func questionStatusEnum(value string) (yaruv1.QuestionStatus, error) {
	switch value {
	case "open":
		return yaruv1.QuestionStatus_QUESTION_STATUS_OPEN, nil
	case "expired":
		return yaruv1.QuestionStatus_QUESTION_STATUS_EXPIRED, nil
	case "answered":
		return yaruv1.QuestionStatus_QUESTION_STATUS_ANSWERED, nil
	case "canceled":
		return yaruv1.QuestionStatus_QUESTION_STATUS_CANCELED, nil
	default:
		return 0, fmt.Errorf("invalid status: expected open, expired, answered, or canceled, actual %s", value)
	}
}

func protoIssueStatus(value string) (yaruv1.IssueStatus, error) {
	switch value {
	case "backlog":
		return yaruv1.IssueStatus_ISSUE_STATUS_BACKLOG, nil
	case "todo":
		return yaruv1.IssueStatus_ISSUE_STATUS_TODO, nil
	case "in_progress":
		return yaruv1.IssueStatus_ISSUE_STATUS_IN_PROGRESS, nil
	case "done":
		return yaruv1.IssueStatus_ISSUE_STATUS_DONE, nil
	case "canceled":
		return yaruv1.IssueStatus_ISSUE_STATUS_CANCELED, nil
	default:
		return 0, fmt.Errorf("invalid status: expected backlog, todo, in_progress, done, or canceled, actual %s", value)
	}
}

func protoPriority(value *string) (*yaruv1.IssuePriority, error) {
	if value == nil {
		return nil, nil
	}
	var priority yaruv1.IssuePriority
	switch *value {
	case "urgent":
		priority = yaruv1.IssuePriority_ISSUE_PRIORITY_URGENT
	case "high":
		priority = yaruv1.IssuePriority_ISSUE_PRIORITY_HIGH
	case "medium":
		priority = yaruv1.IssuePriority_ISSUE_PRIORITY_MEDIUM
	case "low":
		priority = yaruv1.IssuePriority_ISSUE_PRIORITY_LOW
	default:
		return nil, fmt.Errorf("invalid priority: expected urgent, high, medium, or low, actual %s", *value)
	}
	return &priority, nil
}

func copiedString(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func copiedStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return append([]string{}, values...)
}

func copiedFloat(value *float64) *float64 {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func copiedBool(value *bool) *bool {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func copiedInt32(value *int, name string) (*int32, error) {
	if value == nil {
		return nil, nil
	}
	converted, err := fitInt32(*value, name)
	if err != nil {
		return nil, err
	}
	return &converted, nil
}

func fitInt32(value int, name string) (int32, error) {
	if value < math.MinInt32 || value > math.MaxInt32 {
		return 0, fmt.Errorf("invalid %s: expected an int32 from %d to %d, actual %d", name, int(math.MinInt32), int(math.MaxInt32), value)
	}
	return int32(value), nil
}

// tokenFloat は数のトークンを double にする。文字列として連結された数は、その文字列を数として読む。
// docs/spec/routes.md の「数値」。src/sessions.ts:10-30 。
func tokenFloat(count sessions.TokenCount) float64 {
	if !count.Textual {
		return count.Number
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(count.Text), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0
	}
	return parsed
}
