// 板 1 画面。無い id は NotFound にせず、error を載せた成功を返す。
// src/page.ts:94-185、src/web.tsx:708-720、docs/spec/routes.md の「GetPage の本文付き 404」
//
//declscope:core
package api

import (
	"context"
	"fmt"
	"regexp"
	"time"

	connect "connectrpc.com/connect"

	yaruv1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/repository"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

var numericIssueID = regexp.MustCompile(`^[0-9]+$`)

type pageService struct{}

func (pageService) GetPage(ctx context.Context, request *connect.Request[yaruv1.GetPageRequest]) (*connect.Response[yaruv1.GetPageResponse], error) {
	_ = ctx
	moment, now, err := readNow()
	if err != nil {
		return nil, connectError(err)
	}
	space, err := openBySlug(request.Msg.GetWorkspace())
	if err != nil {
		return nil, connectError(err)
	}
	query := ""
	if request.Msg.Query != nil {
		query = *request.Msg.Query
	}
	statusName, statusEcho, err := optionalStatus(request.Msg.Status)
	if err != nil {
		return nil, connectError(err)
	}
	sortValue, err := pageSort(request.Msg.Sort)
	if err != nil {
		return nil, connectError(err)
	}
	groupValue, err := pageGroup(request.Msg.Group)
	if err != nil {
		return nil, connectError(err)
	}
	completedValue, err := pageCompleted(statusName, request.Msg.Completed)
	if err != nil {
		return nil, connectError(err)
	}
	view, err := pageView(request.Msg.View)
	if err != nil {
		return nil, connectError(err)
	}
	sortEnumValue, err := sortEnum(sortValue)
	if err != nil {
		return nil, connectError(err)
	}
	groupEnumValue, err := groupEnum(groupValue)
	if err != nil {
		return nil, connectError(err)
	}
	completedEnumValue, err := completedEnum(completedValue)
	if err != nil {
		return nil, connectError(err)
	}
	directory := questions.Directory{Dir: space.Directory}
	allQuestions, err := questions.ListQuestions(directory, questions.QuestionFilter{}, &moment)
	if err != nil {
		return nil, connectError(err)
	}
	awaitingQuestions := make([]questions.Question, 0)
	for _, question := range allQuestions {
		if question.Status == "open" || question.Status == "expired" {
			awaitingQuestions = append(awaitingQuestions, question)
		}
	}
	awaitingByIssue := summarizeAwaiting(awaitingQuestions)
	filter := store.Filter{}
	if statusName != "" {
		filter.Status = store.Present(statusName)
	}
	assigneeText, assigneeSet := presentText(request.Msg.Assignee)
	if assigneeSet {
		filter.Assignee = store.Present(assigneeText)
	}
	labelText, labelSet := presentText(request.Msg.Label)
	if labelSet {
		filter.Label = store.Present(labelText)
	}
	if query != "" {
		filter.Query = store.Present(query)
	}
	listed, err := store.ListIssues(space, filter, &moment)
	if err != nil {
		return nil, connectError(err)
	}
	awaiting := request.Msg.Awaiting != nil && *request.Msg.Awaiting
	filtered := make([]store.Issue, 0)
	for _, issue := range listed {
		if !store.MatchesCompletedVisibility(issue, completedValue, moment) {
			continue
		}
		if awaiting {
			if _, found := awaitingByIssue[issue.ID]; !found {
				continue
			}
		}
		filtered = append(filtered, issue)
	}
	sorted := store.SortIssues(filtered, sortValue)
	allIssues, err := store.ListIssues(space, store.Filter{}, &moment)
	if err != nil {
		return nil, connectError(err)
	}
	workingDirectory, err := workspace.WorkingDirectory()
	if err != nil {
		return nil, connectError(err)
	}
	viewer := workspace.GitName(workingDirectory)
	current, openedError, err := openPageIssue(space, request.Msg, statusName, viewer, moment)
	if err != nil {
		return nil, connectError(err)
	}
	issueMessagesFiltered, err := issueMessages(sorted)
	if err != nil {
		return nil, connectError(err)
	}
	allMessages, err := issueMessages(allIssues)
	if err != nil {
		return nil, connectError(err)
	}
	comments := []*yaruv1.Comment{}
	pageQuestions := []*yaruv1.Question{}
	events := []*yaruv1.IssueEvent{}
	commits := []*yaruv1.RepositoryCommit{}
	var currentMessage *yaruv1.Issue
	if current != nil {
		currentMessage, err = issueMessage(*current)
		if err != nil {
			return nil, connectError(err)
		}
		if current.ID != "" {
			loadedComments, commentErr := store.ListComments(space.Directory, current.ID)
			if commentErr != nil {
				return nil, connectError(commentErr)
			}
			comments = commentMessages(loadedComments)
			loadedQuestions, questionErr := questions.ListQuestions(directory, questions.QuestionFilter{Issue: current.ID}, &moment)
			if questionErr != nil {
				return nil, connectError(questionErr)
			}
			pageQuestions, err = questionMessages(loadedQuestions)
			if err != nil {
				return nil, connectError(err)
			}
			loadedEvents, eventErr := store.IssueEvents(space, current.ID)
			if eventErr != nil {
				return nil, connectError(eventErr)
			}
			events, err = eventMessages(loadedEvents)
			if err != nil {
				return nil, connectError(err)
			}
			if numericIssueID.MatchString(current.ID) {
				loadedCommits, commitErr := repository.CommitsForIssue(space.Root, current.ID, current.Branch)
				if commitErr != nil {
					return nil, connectError(commitErr)
				}
				commits = commitMessages(loadedCommits)
			}
		}
	}
	awaitingCount, err := int32Count("awaiting question count", len(awaitingQuestions))
	if err != nil {
		return nil, connectError(err)
	}
	response := &yaruv1.GetPageResponse{
		Issues:                issueMessagesFiltered,
		All:                   allMessages,
		Query:                 query,
		Current:               currentMessage,
		Comments:              comments,
		Questions:             pageQuestions,
		Events:                events,
		Commits:               commits,
		Status:                statusEcho,
		Awaiting:              awaiting,
		AwaitingByIssue:       awaitingByIssue,
		Display:               &yaruv1.IssueDisplay{Sort: sortEnumValue, Group: groupEnumValue, Completed: completedEnumValue},
		View:                  view,
		BasePath:              "/p/" + request.Msg.GetWorkspace(),
		AwaitingQuestionCount: awaitingCount,
		Viewer:                viewer,
		Now:                   now,
	}
	if assigneeSet {
		response.Assignee = &assigneeText
	}
	if labelSet {
		response.Label = &labelText
	}
	errorText := openedError
	if request.Msg.Error != nil && *request.Msg.Error != "" {
		errorText = *request.Msg.Error
	}
	if errorText != "" {
		response.Error = &errorText
	}
	return connect.NewResponse(response), nil
}

func optionalStatus(value *yaruv1.IssueStatus) (string, *yaruv1.IssueStatus, error) {
	if value == nil || *value == yaruv1.IssueStatus_ISSUE_STATUS_UNSPECIFIED {
		return "", nil, nil
	}
	name, ok := statusName(*value)
	if !ok {
		return "", nil, fmt.Errorf("invalid status: expected %s, actual %s", store.JoinOr(store.Statuses), enumActual(*value))
	}
	echo := *value
	return name, &echo, nil
}

func pageSort(value *yaruv1.IssueSort) (string, error) {
	if value == nil || *value == yaruv1.IssueSort_ISSUE_SORT_UNSPECIFIED {
		return store.ParseIssueSort(nil)
	}
	name, ok := sortName(*value)
	if !ok {
		return "", fmt.Errorf("invalid sort: expected priority, updated, created, or due, actual %s", enumActual(*value))
	}
	return store.ParseIssueSort(&name)
}

func pageGroup(value *yaruv1.IssueGroup) (string, error) {
	if value == nil || *value == yaruv1.IssueGroup_ISSUE_GROUP_UNSPECIFIED {
		return store.ParseIssueGroup(nil)
	}
	name, ok := groupName(*value)
	if !ok {
		return "", fmt.Errorf("invalid group: expected status, priority, label, or none, actual %s", enumActual(*value))
	}
	return store.ParseIssueGroup(&name)
}

func pageCompleted(statusName string, value *yaruv1.CompletedVisibility) (string, error) {
	if statusName == "done" || statusName == "canceled" {
		return store.CompletedAll, nil
	}
	if value == nil || *value == yaruv1.CompletedVisibility_COMPLETED_VISIBILITY_UNSPECIFIED {
		return store.ParseCompletedVisibility(nil)
	}
	name, ok := completedName(*value)
	if !ok {
		return "", fmt.Errorf("invalid completed: expected hide, recent, or all, actual %s", enumActual(*value))
	}
	return store.ParseCompletedVisibility(&name)
}

func pageView(value *yaruv1.IssueView) (yaruv1.IssueView, error) {
	if value == nil || *value == yaruv1.IssueView_ISSUE_VIEW_UNSPECIFIED || *value == yaruv1.IssueView_ISSUE_VIEW_LIST {
		return yaruv1.IssueView_ISSUE_VIEW_LIST, nil
	}
	if *value == yaruv1.IssueView_ISSUE_VIEW_BOARD {
		return yaruv1.IssueView_ISSUE_VIEW_BOARD, nil
	}
	return 0, fmt.Errorf("invalid view: expected list or board, actual %s", enumActual(*value))
}

func openPageIssue(space workspace.Workspace, request *yaruv1.GetPageRequest, statusName string, viewer string, moment time.Time) (*store.Issue, string, error) {
	if request.Id == nil || *request.Id == "" {
		return nil, "", nil
	}
	issueID := *request.Id
	if issueID == "new" {
		draft, err := newIssueDraft(request, statusName, viewer)
		if err != nil {
			return nil, "", err
		}
		return draft, "", nil
	}
	issue, err := store.GetIssue(space, issueID, &moment)
	if err != nil {
		if err.Error() == "issue not found: "+issueID {
			return nil, err.Error(), nil
		}
		return nil, "", err
	}
	return &issue, "", nil
}

func newIssueDraft(request *yaruv1.GetPageRequest, filterStatus string, viewer string) (*store.Issue, error) {
	status := "todo"
	if request.NewStatus != nil && *request.NewStatus != yaruv1.IssueStatus_ISSUE_STATUS_UNSPECIFIED {
		name, ok := statusName(*request.NewStatus)
		if !ok {
			return nil, fmt.Errorf("invalid status: expected %s, actual %s", store.JoinOr(store.Statuses), enumActual(*request.NewStatus))
		}
		status = name
	} else if filterStatus != "" {
		status = filterStatus
	}
	labels := []string{}
	if request.NewLabel != nil {
		label := javaScriptTrim(*request.NewLabel)
		if label != "" {
			labels = []string{label}
		}
	}
	var parent *string
	if request.NewParent != nil && *request.NewParent != "" {
		parent = copyString(request.NewParent)
	}
	var assignee *string
	if request.NewAssignee != nil {
		assignee = draftAssignee(*request.NewAssignee, viewer)
	}
	return &store.Issue{
		Status:    status,
		Assignee:  assignee,
		Labels:    labels,
		Blocks:    []string{},
		BlockedBy: []string{},
		Children:  []string{},
		Parent:    parent,
	}, nil
}

func draftAssignee(raw string, viewer string) *string {
	assignee := javaScriptTrim(raw)
	if assignee == "" || assignee == "none" {
		return nil
	}
	if assignee == "me" {
		return &viewer
	}
	return &assignee
}

func summarizeAwaiting(awaiting []questions.Question) map[string]*yaruv1.AwaitingSummary {
	summaries := map[string]*yaruv1.AwaitingSummary{}
	for _, question := range awaiting {
		if question.Issue == nil {
			continue
		}
		summary := summaries[*question.Issue]
		if summary == nil {
			summary = &yaruv1.AwaitingSummary{}
			summaries[*question.Issue] = summary
		}
		summary.Count++
		if question.Status == "expired" {
			summary.Expired++
			continue
		}
		if question.AnswerBy != nil && (summary.SoonestAnswerBy == nil || earlierAnswerBy(*question.AnswerBy, summary.GetSoonestAnswerBy())) {
			summary.SoonestAnswerBy = copyString(question.AnswerBy)
		}
	}
	return summaries
}
