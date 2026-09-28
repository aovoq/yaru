// store と questions の値を proto の message に写す。null は optional の未設定。
// docs/spec/routes.md の「値が無いことと空」「列挙の名前」
//
//declscope:core
package api

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/repository"
	"github.com/aovoq/yaru/internal/sessions"
	"github.com/aovoq/yaru/internal/store"
)

func issueMessage(issue store.Issue) (*yaruv1.Issue, error) {
	status, err := statusEnum(issue.Status)
	if err != nil {
		return nil, err
	}
	priority, err := priorityEnum(issue.Priority)
	if err != nil {
		return nil, err
	}
	return &yaruv1.Issue{
		Id:          issue.ID,
		Title:       issue.Title,
		Status:      status,
		Assignee:    copyString(issue.Assignee),
		Labels:      copyStrings(issue.Labels),
		DueDate:     copyString(issue.DueDate),
		Priority:    priority,
		Parent:      copyString(issue.Parent),
		Blocks:      copyStrings(issue.Blocks),
		BlockedBy:   copyStrings(issue.BlockedBy),
		Children:    copyStrings(issue.Children),
		StartedAt:   copyString(issue.StartedAt),
		CompletedAt: copyString(issue.CompletedAt),
		CanceledAt:  copyString(issue.CanceledAt),
		CreatedAt:   issue.CreatedAt,
		UpdatedAt:   issue.UpdatedAt,
		Session:     copyString(issue.Session),
		Worktree:    copyString(issue.Worktree),
		Branch:      copyString(issue.Branch),
		Stale:       issue.Stale,
		Body:        issue.Body,
	}, nil
}

func issueMessages(issues []store.Issue) ([]*yaruv1.Issue, error) {
	messages := make([]*yaruv1.Issue, 0, len(issues))
	for _, issue := range issues {
		message, err := issueMessage(issue)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, nil
}

func commentMessage(comment store.Comment) *yaruv1.Comment {
	return &yaruv1.Comment{
		Id:        comment.ID,
		Issue:     comment.Issue,
		Parent:    copyString(comment.Parent),
		Author:    comment.Author,
		CreatedAt: comment.CreatedAt,
		UpdatedAt: comment.UpdatedAt,
		Body:      comment.Body,
	}
}

func commentMessages(comments []store.Comment) []*yaruv1.Comment {
	messages := make([]*yaruv1.Comment, 0, len(comments))
	for _, comment := range comments {
		messages = append(messages, commentMessage(comment))
	}
	return messages
}

func questionMessage(question questions.Question) (*yaruv1.Question, error) {
	status, err := questionStatusEnum(question.Status)
	if err != nil {
		return nil, err
	}
	priority, err := priorityEnum(question.Priority)
	if err != nil {
		return nil, err
	}
	return &yaruv1.Question{
		Id:                 question.ID,
		Title:              question.Title,
		Status:             status,
		Issue:              copyString(question.Issue),
		Priority:           priority,
		DefaultAction:      copyString(question.DefaultAction),
		AnswerBy:           copyString(question.AnswerBy),
		Options:            copyStrings(question.Options),
		Author:             question.Author,
		Session:            copyString(question.Session),
		Worktree:           copyString(question.Worktree),
		Branch:             copyString(question.Branch),
		Answer:             copyString(question.Answer),
		AnsweredBy:         copyString(question.AnsweredBy),
		AnsweredAt:         copyString(question.AnsweredAt),
		AcknowledgedAt:     copyString(question.AcknowledgedAt),
		NotifiedExpiringAt: copyString(question.NotifiedExpiringAt),
		CanceledAt:         copyString(question.CanceledAt),
		CreatedAt:          question.CreatedAt,
		UpdatedAt:          question.UpdatedAt,
		Body:               question.Body,
	}, nil
}

func questionMessages(questionsToConvert []questions.Question) ([]*yaruv1.Question, error) {
	messages := make([]*yaruv1.Question, 0, len(questionsToConvert))
	for _, question := range questionsToConvert {
		message, err := questionMessage(question)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, nil
}

func eventMessage(event store.IssueEvent) (*yaruv1.IssueEvent, error) {
	message := &yaruv1.IssueEvent{
		Field:   event.Field,
		By:      event.By,
		Session: copyString(event.Session),
		At:      event.At,
	}
	fromText, fromList, err := eventValue(event.From)
	if err != nil {
		return nil, err
	}
	if fromList != nil {
		message.FromValue = &yaruv1.IssueEvent_FromList{FromList: fromList}
	} else if fromText != nil {
		message.FromValue = &yaruv1.IssueEvent_FromText{FromText: *fromText}
	}
	toText, toList, err := eventValue(event.To)
	if err != nil {
		return nil, err
	}
	if toList != nil {
		message.ToValue = &yaruv1.IssueEvent_ToList{ToList: toList}
	} else if toText != nil {
		message.ToValue = &yaruv1.IssueEvent_ToText{ToText: *toText}
	}
	return message, nil
}

func eventMessages(events []store.IssueEvent) ([]*yaruv1.IssueEvent, error) {
	messages := make([]*yaruv1.IssueEvent, 0, len(events))
	for _, event := range events {
		message, err := eventMessage(event)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, nil
}

func eventValue(value any) (*string, *yaruv1.StringList, error) {
	switch typed := value.(type) {
	case nil:
		return nil, nil, nil
	case string:
		return &typed, nil, nil
	case []string:
		return nil, &yaruv1.StringList{Values: copyStrings(typed)}, nil
	default:
		return nil, nil, fmt.Errorf("invalid event value: expected a string, a list, or null, actual %T", value)
	}
}

func commitMessage(commit repository.Commit) *yaruv1.RepositoryCommit {
	return &yaruv1.RepositoryCommit{
		Hash:        commit.Hash,
		Subject:     commit.Subject,
		Author:      commit.Author,
		CommittedAt: commit.CommittedAt,
		Pushed:      copyBool(commit.Pushed),
	}
}

func commitMessages(commits []repository.Commit) []*yaruv1.RepositoryCommit {
	messages := make([]*yaruv1.RepositoryCommit, 0, len(commits))
	for _, commit := range commits {
		messages = append(messages, commitMessage(commit))
	}
	return messages
}

func statusEnum(value string) (yaruv1.IssueStatus, error) {
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
		return 0, fmt.Errorf("invalid status: expected %s, actual %s", store.JoinOr(store.Statuses()), value)
	}
}

func statusName(value yaruv1.IssueStatus) (string, bool) {
	switch value {
	case yaruv1.IssueStatus_ISSUE_STATUS_BACKLOG:
		return "backlog", true
	case yaruv1.IssueStatus_ISSUE_STATUS_TODO:
		return "todo", true
	case yaruv1.IssueStatus_ISSUE_STATUS_IN_PROGRESS:
		return "in_progress", true
	case yaruv1.IssueStatus_ISSUE_STATUS_DONE:
		return "done", true
	case yaruv1.IssueStatus_ISSUE_STATUS_CANCELED:
		return "canceled", true
	default:
		return "", false
	}
}

func priorityEnum(value *string) (*yaruv1.IssuePriority, error) {
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
		return nil, fmt.Errorf("invalid priority: expected %s, actual %s", store.JoinOr(store.Priorities()), *value)
	}
	return &priority, nil
}

func priorityName(value yaruv1.IssuePriority) (string, bool) {
	switch value {
	case yaruv1.IssuePriority_ISSUE_PRIORITY_URGENT:
		return "urgent", true
	case yaruv1.IssuePriority_ISSUE_PRIORITY_HIGH:
		return "high", true
	case yaruv1.IssuePriority_ISSUE_PRIORITY_MEDIUM:
		return "medium", true
	case yaruv1.IssuePriority_ISSUE_PRIORITY_LOW:
		return "low", true
	default:
		return "", false
	}
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
		return 0, fmt.Errorf("invalid question status: expected open, expired, answered, or canceled, actual %s", value)
	}
}

func sortName(value yaruv1.IssueSort) (string, bool) {
	switch value {
	case yaruv1.IssueSort_ISSUE_SORT_PRIORITY:
		return store.SortPriority, true
	case yaruv1.IssueSort_ISSUE_SORT_UPDATED:
		return store.SortUpdated, true
	case yaruv1.IssueSort_ISSUE_SORT_CREATED:
		return store.SortCreated, true
	case yaruv1.IssueSort_ISSUE_SORT_DUE:
		return store.SortDue, true
	default:
		return "", false
	}
}

func sortEnum(value string) (yaruv1.IssueSort, error) {
	switch value {
	case store.SortPriority:
		return yaruv1.IssueSort_ISSUE_SORT_PRIORITY, nil
	case store.SortUpdated:
		return yaruv1.IssueSort_ISSUE_SORT_UPDATED, nil
	case store.SortCreated:
		return yaruv1.IssueSort_ISSUE_SORT_CREATED, nil
	case store.SortDue:
		return yaruv1.IssueSort_ISSUE_SORT_DUE, nil
	default:
		return 0, fmt.Errorf("invalid sort: expected priority, updated, created, or due, actual %s", value)
	}
}

func groupName(value yaruv1.IssueGroup) (string, bool) {
	switch value {
	case yaruv1.IssueGroup_ISSUE_GROUP_STATUS:
		return store.GroupStatus, true
	case yaruv1.IssueGroup_ISSUE_GROUP_PRIORITY:
		return store.GroupPriority, true
	case yaruv1.IssueGroup_ISSUE_GROUP_LABEL:
		return store.GroupLabel, true
	case yaruv1.IssueGroup_ISSUE_GROUP_NONE:
		return store.GroupNone, true
	default:
		return "", false
	}
}

func groupEnum(value string) (yaruv1.IssueGroup, error) {
	switch value {
	case store.GroupStatus:
		return yaruv1.IssueGroup_ISSUE_GROUP_STATUS, nil
	case store.GroupPriority:
		return yaruv1.IssueGroup_ISSUE_GROUP_PRIORITY, nil
	case store.GroupLabel:
		return yaruv1.IssueGroup_ISSUE_GROUP_LABEL, nil
	case store.GroupNone:
		return yaruv1.IssueGroup_ISSUE_GROUP_NONE, nil
	default:
		return 0, fmt.Errorf("invalid group: expected status, priority, label, or none, actual %s", value)
	}
}

func completedName(value yaruv1.CompletedVisibility) (string, bool) {
	switch value {
	case yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_HIDE:
		return store.CompletedHide, true
	case yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_RECENT:
		return store.CompletedRecent, true
	case yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_ALL:
		return store.CompletedAll, true
	default:
		return "", false
	}
}

func completedEnum(value string) (yaruv1.CompletedVisibility, error) {
	switch value {
	case store.CompletedHide:
		return yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_HIDE, nil
	case store.CompletedRecent:
		return yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_RECENT, nil
	case store.CompletedAll:
		return yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_ALL, nil
	default:
		return 0, fmt.Errorf("invalid completed: expected hide, recent, or all, actual %s", value)
	}
}

func patchOperations(list *yaruv1.PatchList) any {
	if list == nil {
		return nil
	}
	operations := make([]any, 0, len(list.GetOperations()))
	for _, operation := range list.GetOperations() {
		if operation == nil {
			operations = append(operations, nil)
			continue
		}
		object := map[string]any{}
		if name, ok := patchKindName(operation.GetKind()); ok {
			object["op"] = name
		}
		if operation.OldString != nil {
			object["old_string"] = *operation.OldString
		}
		if operation.NewString != nil {
			object["new_string"] = *operation.NewString
		}
		if operation.ReplaceAll != nil {
			object["replace_all"] = *operation.ReplaceAll
		}
		if operation.Anchor != nil {
			object["anchor"] = *operation.Anchor
		}
		if operation.Text != nil {
			object["text"] = *operation.Text
		}
		if operation.From != nil {
			object["from"] = *operation.From
		}
		if operation.To != nil {
			object["to"] = *operation.To
		}
		operations = append(operations, object)
	}
	return operations
}

func patchKindName(kind yaruv1.PatchOpKind) (string, bool) {
	switch kind {
	case yaruv1.PatchOpKind_PATCH_OP_KIND_REPLACE:
		return "replace", true
	case yaruv1.PatchOpKind_PATCH_OP_KIND_INSERT_BEFORE:
		return "insert_before", true
	case yaruv1.PatchOpKind_PATCH_OP_KIND_INSERT_AFTER:
		return "insert_after", true
	case yaruv1.PatchOpKind_PATCH_OP_KIND_PREPEND:
		return "prepend", true
	case yaruv1.PatchOpKind_PATCH_OP_KIND_APPEND:
		return "append", true
	case yaruv1.PatchOpKind_PATCH_OP_KIND_REPLACE_RANGE:
		return "replace_range", true
	default:
		return "", false
	}
}

func copyString(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func copyBool(value *bool) *bool {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func copyFloat(value *float64) *float64 {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func copyInt32(value *int, name string) (*int32, error) {
	if value == nil {
		return nil, nil
	}
	converted, err := int32Count(name, *value)
	if err != nil {
		return nil, err
	}
	return &converted, nil
}

func copyStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string{}, values...)
}

func int32Count(name string, value int) (int32, error) {
	if value < 0 || value > math.MaxInt32 {
		return 0, fmt.Errorf("invalid %s: expected an int32 from 0 to %d, actual %d", name, math.MaxInt32, value)
	}
	return int32(value), nil
}

// javaScriptTrim は String.prototype.trim。U+0085 は外さない。src/page.ts:167
func javaScriptTrim(value string) string {
	start := 0
	end := len(value)
	for start < end {
		character, size := utf8.DecodeRuneInString(value[start:])
		if !javaScriptWhitespace(character) {
			break
		}
		start += size
	}
	for end > start {
		character, size := utf8.DecodeLastRuneInString(value[:end])
		if !javaScriptWhitespace(character) {
			break
		}
		end -= size
	}
	return value[start:end]
}

func javaScriptWhitespace(character rune) bool {
	switch character {
	case '\u0009', '\u000b', '\u000c', '\u0020', '\u00a0', '\ufeff', '\n', '\r', '\u2028', '\u2029':
		return true
	default:
		return unicode.Is(unicode.Zs, character)
	}
}

// earlierAnswerBy は Date.parse の比較。読めない文字列は NaN なので、早くないとみなす。src/page.ts:206-210
func earlierAnswerBy(candidate string, current string) bool {
	candidateTime, candidateOK := parseAnswerBy(candidate)
	currentTime, currentOK := parseAnswerBy(current)
	if !candidateOK || !currentOK {
		return false
	}
	return candidateTime.Before(currentTime)
}

func parseAnswerBy(value string) (time.Time, bool) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

func enumActual(value interface{ String() string }) string {
	text := value.String()
	if text == "" {
		return "0"
	}
	if strings.Contains(text, " ") {
		return text
	}
	return text
}

// protoSessionHealth は dashboard のセッション。件数は int32、トークンは double。
// docs/spec/routes.md の「数値」。src/sessions.ts:44-49 、src/dashboard.tsx:35-52 。
func protoSessionHealth(health sessions.Health) (*yaruv1.SessionHealth, error) {
	windowDays, err := int32Count("windowDays", health.WindowDays)
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
		Directory:  copyString(health.Directory),
		WindowDays: windowDays,
		Sessions:   summaries,
		Totals:     totals,
	}, nil
}

func protoSession(session sessions.Summary) (*yaruv1.SessionSummary, error) {
	assistantMessages, err := int32Count("assistantMessages", session.AssistantMessages)
	if err != nil {
		return nil, err
	}
	unpriced, err := int32Count("unpricedMessages", session.UnpricedMessages)
	if err != nil {
		return nil, err
	}
	toolUses, err := int32Count("toolUses", session.ToolUses)
	if err != nil {
		return nil, err
	}
	toolResults, err := int32Count("toolResults", session.ToolResults)
	if err != nil {
		return nil, err
	}
	toolErrors, err := int32Count("toolErrors", session.ToolErrors)
	if err != nil {
		return nil, err
	}
	interruptions, err := int32Count("interruptions", session.Interruptions)
	if err != nil {
		return nil, err
	}
	subagents, err := int32Count("subagents", session.Subagents)
	if err != nil {
		return nil, err
	}
	return &yaruv1.SessionSummary{
		Id:                  session.ID,
		Worktree:            copyString(session.Worktree),
		Title:               copyString(session.Title),
		StartedAt:           copyString(session.StartedAt),
		LastActivityAt:      copyString(session.LastActivityAt),
		Models:              copyStrings(session.Models),
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
	sessionCount, err := int32Count("sessions", totals.Sessions)
	if err != nil {
		return nil, err
	}
	unpriced, err := int32Count("unpricedMessages", totals.UnpricedMessages)
	if err != nil {
		return nil, err
	}
	assistantMessages, err := int32Count("assistantMessages", totals.AssistantMessages)
	if err != nil {
		return nil, err
	}
	toolResults, err := int32Count("toolResults", totals.ToolResults)
	if err != nil {
		return nil, err
	}
	toolErrors, err := int32Count("toolErrors", totals.ToolErrors)
	if err != nil {
		return nil, err
	}
	interruptions, err := int32Count("interruptions", totals.Interruptions)
	if err != nil {
		return nil, err
	}
	return &yaruv1.SessionTotals{
		Sessions:          sessionCount,
		CostUsd:           totals.CostUsd,
		UnpricedMessages:  unpriced,
		AssistantMessages: assistantMessages,
		CacheReadRatio:    copyFloat(totals.CacheReadRatio),
		ToolResults:       toolResults,
		ToolErrors:        toolErrors,
		ToolErrorRatio:    copyFloat(totals.ToolErrorRatio),
		Interruptions:     interruptions,
	}, nil
}

// protoRepository は git でなければ未設定。コミットは commitMessage と同じ形。
// src/repository.ts:26-27 、src/web.tsx:441 。
func protoRepository(state *repository.State) (*yaruv1.RepositoryState, error) {
	if state == nil {
		return nil, nil
	}
	ahead, err := copyInt32(state.Ahead, "ahead")
	if err != nil {
		return nil, err
	}
	behind, err := copyInt32(state.Behind, "behind")
	if err != nil {
		return nil, err
	}
	uncommitted, err := int32Count("uncommittedFiles", state.UncommittedFiles)
	if err != nil {
		return nil, err
	}
	return &yaruv1.RepositoryState{
		Branch:           copyString(state.Branch),
		Upstream:         copyString(state.Upstream),
		Ahead:            ahead,
		Behind:           behind,
		UncommittedFiles: uncommitted,
		Commits:          commitMessages(state.Commits),
	}, nil
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
