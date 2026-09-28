//declscope:namespace issue

package store

import (
	"math"
	"sort"
	"strings"
	"time"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/document"
)

// 板の並び。既定は優先度の高い順、同じ優先度なら id の大きい順。
// 更新時刻で並べると、本文を書き足すたびに行が跳ねるため。src/issue-order.ts:3-6

const (
	SortPriority = "priority"
	SortUpdated  = "updated"
	SortCreated  = "created"
	SortDue      = "due"

	GroupStatus   = "status"
	GroupPriority = "priority"
	GroupLabel    = "label"
	GroupNone     = "none"

	CompletedHide   = "hide"
	CompletedRecent = "recent"
	CompletedAll    = "all"

	// CompletedRecentDays は recent のときに見せる、終わってからの日数。src/issue-order.ts:30
	CompletedRecentDays = 7
)

// IssueDisplay は板の並び・グループ・終わった issue の見せ方。src/issue-order.ts:17-27
type IssueDisplay struct {
	Sort      string
	Group     string
	Completed string
}

// defaultIssueDisplay は優先度順、状態でグループ、終わって 7 日以内だけ見せる。
var defaultIssueDisplay = IssueDisplay{Sort: SortPriority, Group: GroupStatus, Completed: CompletedRecent}

// DefaultIssueDisplay は板の既定の写しを返す。src/issue-order.ts:17-27
func DefaultIssueDisplay() IssueDisplay {
	return defaultIssueDisplay
}

var issueSorts = []string{SortPriority, SortUpdated, SortCreated, SortDue}
var issueGroups = []string{GroupStatus, GroupPriority, GroupLabel, GroupNone}
var issueCompletedVisibilities = []string{CompletedHide, CompletedRecent, CompletedAll}

const issueNoPriorityRank = 4

// ParseIssueSort は未知の値を拒み、空は既定の priority にする。src/issue-order.ts:37-39
func ParseIssueSort(value *string) (string, error) {
	return issueParseChoice("sort", issueSorts, DefaultIssueDisplay().Sort, value)
}

// ParseIssueGroup は未知の値を拒み、空は既定の status にする。src/issue-order.ts:41-43
func ParseIssueGroup(value *string) (string, error) {
	return issueParseChoice("group", issueGroups, DefaultIssueDisplay().Group, value)
}

// ParseCompletedVisibility は未知の値を拒み、空は既定の recent にする。src/issue-order.ts:45-47
func ParseCompletedVisibility(value *string) (string, error) {
	return issueParseChoice("completed", issueCompletedVisibilities, DefaultIssueDisplay().Completed, value)
}

// SortIssues は入力の並びを変えずに、指定した順の新しいスライスを返す。src/issue-order.ts:49-51
func SortIssues(issues []Issue, sortName string) []Issue {
	sorted := append([]Issue{}, issues...)
	sort.SliceStable(sorted, func(left int, right int) bool {
		return compareIssues(sorted[left], sorted[right], sortName) < 0
	})
	return sorted
}

// MatchesCompletedVisibility は終わっていない issue を常に見せる。
// 終わった issue は、終わった時刻から CompletedRecentDays より前なら recent では隠す。等号は隠す。
// 完了時刻が無いものは updatedAt で決める。src/issue-order.ts:54-68
func MatchesCompletedVisibility(issue Issue, visibility string, now time.Time) bool {
	if issue.Status != "done" && issue.Status != "canceled" {
		return true
	}
	if visibility == CompletedAll {
		return true
	}
	if visibility == CompletedHide {
		return false
	}
	finishedText := issue.UpdatedAt
	finished := issue.CanceledAt
	if issue.Status == "done" {
		finished = issue.CompletedAt
	}
	if finished != nil {
		finishedText = *finished
	}
	parsed, ok := clock.ParseJavaScriptTime(finishedText)
	if !ok {
		return true
	}
	return now.Sub(parsed) < time.Duration(CompletedRecentDays)*24*time.Hour
}

func compareIssues(left Issue, right Issue, sortName string) int {
	switch sortName {
	case SortUpdated:
		if comparison := strings.Compare(right.UpdatedAt, left.UpdatedAt); comparison != 0 {
			return comparison
		}
		return issueCompareIDDescending(left, right)
	case SortCreated:
		if comparison := strings.Compare(right.CreatedAt, left.CreatedAt); comparison != 0 {
			return comparison
		}
		return issueCompareIDDescending(left, right)
	case SortDue:
		if comparison := issueCompareDueDate(left, right); comparison != 0 {
			return comparison
		}
		return issueComparePriority(left, right)
	default:
		return issueComparePriority(left, right)
	}
}

func issueComparePriority(left Issue, right Issue) int {
	if comparison := issuePriorityRank(left) - issuePriorityRank(right); comparison != 0 {
		return comparison
	}
	return issueCompareIDDescending(left, right)
}

func issueCompareDueDate(left Issue, right Issue) int {
	if issueSameOptionalString(left.DueDate, right.DueDate) {
		return 0
	}
	if left.DueDate == nil {
		return 1
	}
	if right.DueDate == nil {
		return -1
	}
	return strings.Compare(*left.DueDate, *right.DueDate)
}

func issuePriorityRank(issue Issue) int {
	if issue.Priority == nil {
		return issueNoPriorityRank
	}
	switch *issue.Priority {
	case "urgent":
		return 0
	case "high":
		return 1
	case "medium":
		return 2
	case "low":
		return 3
	default:
		return issueNoPriorityRank
	}
}

// compareIDDescending は数として大きい id を前に置く。数でない名前は文字の降順。
// src/issue-order.ts:101-104
func issueCompareIDDescending(left Issue, right Issue) int {
	rightNumber, rightOK := document.ParseNumber(right.ID)
	leftNumber, leftOK := document.ParseNumber(left.ID)
	if !rightOK || !leftOK {
		return strings.Compare(right.ID, left.ID)
	}
	difference := rightNumber - leftNumber
	if math.IsNaN(difference) {
		return strings.Compare(right.ID, left.ID)
	}
	if difference > 0 {
		return 1
	}
	if difference < 0 {
		return -1
	}
	return 0
}

func issueParseChoice(name string, choices []string, fallback string, value *string) (string, error) {
	if value == nil || *value == "" {
		return fallback, nil
	}
	for _, choice := range choices {
		if choice == *value {
			return choice, nil
		}
	}
	quoted, err := document.Quote(*value)
	if err != nil {
		return "", err
	}
	return "", issueErrString("invalid " + name + ": expected " + JoinOr(choices) + ", actual " + quoted)
}

// sortIssuesForList は updatedAt の降順、同じなら id を文字の降順にする。数としては比べない。
// src/store.ts:209、docs/spec/yaru-format.md の「notified-stale-issues.json」。
func sortIssuesForList(issues []Issue) {
	sort.SliceStable(issues, func(left int, right int) bool {
		comparison := strings.Compare(issues[right].UpdatedAt, issues[left].UpdatedAt)
		if comparison == 0 {
			comparison = strings.Compare(issues[right].ID, issues[left].ID)
		}
		return comparison < 0
	})
}
