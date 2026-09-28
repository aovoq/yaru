package store

import (
	"context"
	"errors"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/errs"
	"github.com/aovoq/yaru/internal/workspace"
)

func issueDocumentReady() (ready bool) {
	defer func() {
		if recover() != nil {
			ready = false
		}
	}()
	if clock.ISOString(time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)) == "" {
		return false
	}
	encoded, err := document.MarshalJavaScript("ok")
	if err != nil || string(encoded) != `"ok"` {
		return false
	}
	if _, err = document.Parse("---\nid: 1\n---\n\n\n"); err != nil {
		return false
	}
	if document.Format([]document.Field{{Key: "id", Value: "1"}}, "") == "" {
		return false
	}
	return true
}

func issueGitReady() (ready bool) {
	defer func() {
		if recover() != nil {
			ready = false
		}
	}()
	if !issueDocumentReady() {
		return false
	}
	workingDirectory, err := workspace.WorkingDirectory(context.Background())
	if err != nil {
		return false
	}
	if workspace.GitName(context.Background(), workingDirectory) == "" {
		return false
	}
	return true
}

// 土台 (document・clock・workspace) は中身が panic のままなので、ファイルのバイト列を確かめるテストはそこが入るまで飛ばす。
// 飛ばしたテストは docs/spec/yaru-format.md の例と、一時ディレクトリで動かした TS 版の結果を期待値にしている。
func issueSkipWithoutDocument(t *testing.T) {
	t.Helper()
	if !issueDocumentReady() {
		t.Skip("document and clock still panic")
	}
}

func issueSkipWithoutGitName(t *testing.T) {
	t.Helper()
	if !issueGitReady() {
		t.Skip("workspace.GitName still panics")
	}
}

func TestBlankToNull(t *testing.T) {
	if BlankToNull(Optional[string]{}).Set {
		t.Fatal("absent value became present")
	}
	nullValue := BlankToNull(Null[string]())
	if !nullValue.Set || nullValue.Value != nil {
		t.Fatal("null did not stay null")
	}
	for _, value := range []string{"", "  ", "none", " none "} {
		got := BlankToNull(Present(value))
		if !got.Set || got.Value != nil {
			t.Fatalf("expected null for %q", value)
		}
	}
	kept := BlankToNull(Present("  Ada  "))
	if kept.Value == nil || *kept.Value != "Ada" {
		t.Fatalf("expected Ada, actual %v", kept.Value)
	}
	// 「me」は空にしない。担当の置換は resolveAssignee が行う (src/store.ts:400-411)。
	me := BlankToNull(Present(" me "))
	if me.Value == nil || *me.Value != "me" {
		t.Fatal("me was cleared")
	}
	// JS の trim は U+0085 を削らない。Go の strings.TrimSpace は削る。
	padded := "\u0085Ada"
	if got := BlankToNull(Present(padded)); got.Value == nil || *got.Value != padded {
		t.Fatalf("expected U+0085 to remain, actual %v", got.Value)
	}
	ideographic := BlankToNull(Present("\u3000Ada\u3000"))
	if ideographic.Value == nil || *ideographic.Value != "Ada" {
		t.Fatal("ideographic space was not trimmed")
	}
}

func TestResolveDueDate(t *testing.T) {
	accepted := []string{"2026-08-20", "0100-01-01", "2000-02-29", "2024-02-29"}
	for _, value := range accepted {
		got, err := issueResolveDueDate(Present(value))
		if err != nil || got.Value == nil || *got.Value != value {
			t.Fatalf("expected %s to be accepted, err %v got %v", value, err, got.Value)
		}
	}
	rejected := []string{"0001-01-01", "0099-12-31", "0100-02-29", "1900-02-29", "2026-02-30", "2026-08-20T00:00:00Z", "08-20"}
	for _, value := range rejected {
		_, err := issueResolveDueDate(Present(value))
		if err == nil || err.Error() != "invalid dueDate: expected YYYY-MM-DD, actual "+value {
			t.Fatalf("value %q: %v", value, err)
		}
	}
	spaced := " 2026-02-30"
	_, err := issueResolveDueDate(Present(spaced))
	if err == nil || err.Error() != "invalid dueDate: expected YYYY-MM-DD, actual "+spaced {
		t.Fatalf("spaced: %v", err)
	}
	cleared, err := issueResolveDueDate(Present("none"))
	if err != nil || cleared.Value != nil {
		t.Fatal("none was not cleared")
	}
	if _, err := issueResolveDueDate(Optional[string]{}); err != nil {
		t.Fatal(err)
	}
}

func TestResolvePriorityAndStatus(t *testing.T) {
	got, err := ResolvePriority(Present(" high "))
	if err != nil || got.Value == nil || *got.Value != "high" {
		t.Fatalf("priority: %v %v", got.Value, err)
	}
	cleared, err := ResolvePriority(Present("none"))
	if err != nil || cleared.Value != nil {
		t.Fatal("priority none was not cleared")
	}
	for _, value := range []string{"p0", "0", "Urgent"} {
		_, err := ResolvePriority(Present(value))
		if err == nil || err.Error() != "invalid priority: expected urgent, high, medium, or low, actual "+value {
			t.Fatalf("priority %q: %v", value, err)
		}
	}
	spaced := " Urgent"
	_, err = ResolvePriority(Present(spaced))
	if err == nil || err.Error() != "invalid priority: expected urgent, high, medium, or low, actual "+spaced {
		t.Fatalf("spaced priority: %v", err)
	}
	for _, value := range []string{"nope", "Todo"} {
		_, err := issueResolveStatus(value)
		if err == nil || err.Error() != "invalid status: expected backlog, todo, in_progress, done, or canceled, actual "+value {
			t.Fatalf("status %q: %v", value, err)
		}
	}
	status, err := issueResolveStatus(" todo ")
	if err != nil || status != "todo" {
		t.Fatalf("trimmed status: %s %v", status, err)
	}
}

func TestResolveLimit(t *testing.T) {
	got, err := ResolveLimit(nil)
	if err != nil || got != ListLimitDefault {
		t.Fatalf("default: %d %v", got, err)
	}
	got, err = ResolveLimit(2)
	if err != nil || got != 2 {
		t.Fatalf("2: %d %v", got, err)
	}
	_, err = ResolveLimit(0)
	if err == nil || err.Error() != "invalid limit: expected an integer from 1 to 250, actual 0" {
		t.Fatal(err)
	}
	_, err = ResolveLimit(251)
	if err == nil || err.Error() != "invalid limit: expected an integer from 1 to 250, actual 251" {
		t.Fatal(err)
	}
	_, err = ResolveLimit(1.5)
	if err == nil || err.Error() != "invalid limit: expected an integer from 1 to 250, actual 1.5" {
		t.Fatal(err)
	}
	_, err = ResolveLimit(issueNan())
	if err == nil || err.Error() != "invalid limit: expected an integer from 1 to 250, actual NaN" {
		t.Fatal(err)
	}
}

func TestPageIssues(t *testing.T) {
	issues := []Issue{bareIssue("3"), bareIssue("2"), bareIssue("1")}
	first, err := PageIssues(issues, PageOptions{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if issueIds(first.Issues) != "3,2" || !first.HasNextPage || first.Cursor == nil || *first.Cursor != "2" {
		t.Fatalf("first page: %+v", first)
	}
	second, err := PageIssues(issues, PageOptions{Limit: 2, Cursor: first.Cursor})
	if err != nil {
		t.Fatal(err)
	}
	if issueIds(second.Issues) != "1" || second.HasNextPage || second.Cursor != nil {
		t.Fatalf("second page: %+v", second)
	}
	_, err = PageIssues(issues, PageOptions{Cursor: issueStringPointer("99")})
	if err == nil || err.Error() != "cursor not found: expected an issue id from a previous list page, actual 99" {
		t.Fatal(err)
	}
}

func TestListOrderUsesLocaleCompare(t *testing.T) {
	issues := []Issue{bareIssue("10"), bareIssue("2"), bareIssue("9"), bareIssue("1")}
	for index := range issues {
		issues[index].UpdatedAt = "2026-09-25T09:00:00.000Z"
	}
	sortIssuesForList(issues)
	if issueIds(issues) != "9,2,10,1" {
		t.Fatalf("list order: %s", issueIds(issues))
	}
}

func TestSortIssues(t *testing.T) {
	issues := []Issue{
		issueWithPriority("9", "low"),
		issueWithPriority("10", ""),
		issueWithPriority("2", "urgent"),
		issueWithPriority("11", "low"),
		issueWithPriority("3", "high"),
		issueWithPriority("4", "medium"),
		issueWithPriority("12", ""),
	}
	sorted := SortIssues(issues, SortPriority)
	if issueIds(sorted) != "2,3,4,11,9,12,10" {
		t.Fatalf("priority: %s", issueIds(sorted))
	}
	if issues[0].ID != "9" {
		t.Fatal("sort mutated the input")
	}
	nonNumeric := SortIssues([]Issue{bareIssue("alpha"), bareIssue("2"), bareIssue("beta")}, SortPriority)
	if issueIds(nonNumeric) != "beta,alpha,2" {
		t.Fatalf("non numeric: %s", issueIds(nonNumeric))
	}
	timed := []Issue{bareIssue("9"), bareIssue("10"), bareIssue("1")}
	timed[0].UpdatedAt = "2026-09-20T00:00:00.000Z"
	timed[0].CreatedAt = "2026-09-01T00:00:00.000Z"
	timed[1].UpdatedAt = "2026-09-20T00:00:00.000Z"
	timed[1].CreatedAt = "2026-09-02T00:00:00.000Z"
	timed[2].UpdatedAt = "2026-09-21T00:00:00.000Z"
	timed[2].CreatedAt = "2026-09-02T00:00:00.000Z"
	if issueIds(SortIssues(timed, SortUpdated)) != "1,10,9" {
		t.Fatalf("updated: %s", issueIds(SortIssues(timed, SortUpdated)))
	}
	if issueIds(SortIssues(timed, SortCreated)) != "10,1,9" {
		t.Fatalf("created: %s", issueIds(SortIssues(timed, SortCreated)))
	}
	due := []Issue{
		issueWithDue("1", "", "urgent"),
		issueWithDue("2", "2026-10-02", ""),
		issueWithDue("3", "2026-10-01", "low"),
		issueWithDue("4", "2026-10-01", "high"),
	}
	if issueIds(SortIssues(due, SortDue)) != "4,3,2,1" {
		t.Fatalf("due: %s", issueIds(SortIssues(due, SortDue)))
	}
}

func TestParseDisplayChoices(t *testing.T) {
	if got, err := ParseIssueSort(nil); err != nil || got != SortPriority {
		t.Fatalf("nil sort: %s %v", got, err)
	}
	if got, err := ParseIssueSort(issueStringPointer("")); err != nil || got != SortPriority {
		t.Fatalf("empty sort: %s %v", got, err)
	}
	if got, err := ParseIssueSort(issueStringPointer("due")); err != nil || got != SortDue {
		t.Fatalf("due: %s %v", got, err)
	}
	if got, err := ParseIssueGroup(nil); err != nil || got != GroupStatus {
		t.Fatal(err)
	}
	if got, err := ParseIssueGroup(issueStringPointer("none")); err != nil || got != GroupNone {
		t.Fatal(err)
	}
	if got, err := ParseCompletedVisibility(nil); err != nil || got != CompletedRecent {
		t.Fatal(err)
	}
	if got, err := ParseCompletedVisibility(issueStringPointer("all")); err != nil || got != CompletedAll {
		t.Fatal(err)
	}
}

func TestParseDisplayChoicesRejectUnknown(t *testing.T) {
	issueSkipWithoutDocument(t)
	_, err := ParseIssueSort(issueStringPointer("title"))
	if err == nil || err.Error() != `invalid sort: expected priority, updated, created, or due, actual "title"` {
		t.Fatal(err)
	}
	_, err = ParseIssueGroup(issueStringPointer("assignee"))
	if err == nil || err.Error() != `invalid group: expected status, priority, label, or none, actual "assignee"` {
		t.Fatal(err)
	}
	_, err = ParseCompletedVisibility(issueStringPointer("old"))
	if err == nil || err.Error() != `invalid completed: expected hide, recent, or all, actual "old"` {
		t.Fatal(err)
	}
}

func TestCompletedVisibility(t *testing.T) {
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	day := 24 * time.Hour
	recentlyDone := bareIssue("1")
	recentlyDone.Status = "done"
	recentlyDone.CompletedAt = issueStringPointer(now.Add(-(time.Duration(CompletedRecentDays)*day - time.Millisecond)).UTC().Format(time.RFC3339Nano))
	longDone := bareIssue("2")
	longDone.Status = "done"
	longDone.CompletedAt = issueStringPointer(now.Add(-(time.Duration(CompletedRecentDays)*day + time.Millisecond)).UTC().Format(time.RFC3339Nano))
	exact := bareIssue("6")
	exact.Status = "done"
	exact.CompletedAt = issueStringPointer(now.Add(-time.Duration(CompletedRecentDays) * day).UTC().Format(time.RFC3339Nano))
	recentlyCanceled := bareIssue("3")
	recentlyCanceled.Status = "canceled"
	recentlyCanceled.CanceledAt = issueStringPointer(now.Add(-day).UTC().Format(time.RFC3339Nano))
	handEdited := bareIssue("4")
	handEdited.Status = "done"
	handEdited.UpdatedAt = now.Add(-30 * day).UTC().Format(time.RFC3339Nano)
	open := bareIssue("5")
	open.UpdatedAt = "2020-01-01T00:00:00.000Z"
	rows := []Issue{recentlyDone, longDone, recentlyCanceled, handEdited, open}
	if issueIds(issueFilterCompleted(rows, CompletedRecent, now)) != "1,3,5" {
		t.Fatalf("recent: %s", issueIds(issueFilterCompleted(rows, CompletedRecent, now)))
	}
	if issueIds(issueFilterCompleted(rows, CompletedHide, now)) != "5" {
		t.Fatalf("hide: %s", issueIds(issueFilterCompleted(rows, CompletedHide, now)))
	}
	if issueIds(issueFilterCompleted(append(rows, exact), CompletedAll, now)) != "1,2,3,4,5,6" {
		t.Fatal(issueIds(issueFilterCompleted(append(rows, exact), CompletedAll, now)))
	}
	if MatchesCompletedVisibility(exact, CompletedRecent, now) {
		t.Fatal("exactly 7 days is still recent")
	}
}

func TestDueDateDisplay(t *testing.T) {
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.Local)
	if !IsIssueOverdue(issueStringPointer("2026-09-25"), "todo", now) {
		t.Fatal("past open issue was not overdue")
	}
	if IsIssueOverdue(issueStringPointer("2026-09-26"), "in_progress", now) {
		t.Fatal("today was overdue")
	}
	if IsIssueOverdue(issueStringPointer("2026-01-01"), "done", now) || IsIssueOverdue(issueStringPointer("2026-01-01"), "canceled", now) {
		t.Fatal("finished issue was overdue")
	}
	if IsIssueOverdue(nil, "todo", now) {
		t.Fatal("missing due date was overdue")
	}
	if FormatDueDate("2026-10-20", now) != "Oct 20" || FormatDueDate("2026-01-01", now) != "Jan 1" {
		t.Fatal(FormatDueDate("2026-10-20", now), FormatDueDate("2026-01-01", now))
	}
	if FormatDueDate("2027-10-20", now) != "Oct 20, 2027" || FormatDueDate("2025-12-31", now) != "Dec 31, 2025" {
		t.Fatal("other year")
	}
	if FormatDueDate("2026-01-01", time.Date(2026, 1, 1, 0, 0, 0, 0, time.Local)) != "Jan 1" {
		t.Fatal("calendar date shifted")
	}
	if FormatDueDate("someday", now) != "someday" || FormatDueDate("2026-13-01", now) != "2026-13-01" {
		t.Fatal("malformed due date was rewritten")
	}
}

func TestStaleAfter(t *testing.T) {
	if got, err := ParseStaleAfter("30m"); err != nil || got != 30*60_000 {
		t.Fatal(got, err)
	}
	if got, err := ParseStaleAfter("2h"); err != nil || got != 2*3_600_000 {
		t.Fatal(got, err)
	}
	if got, err := ParseStaleAfter("3d"); err != nil || got != 3*86_400_000 {
		t.Fatal(got, err)
	}
	if got, err := ParseStaleAfter(" 90m "); err != nil || got != 90*60_000 {
		t.Fatal(got, err)
	}
	updatedAt := "2026-09-20T00:00:00.000Z"
	later := time.Date(2026, 9, 21, 0, 0, 0, int(time.Millisecond), time.UTC)
	exact := time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC)
	if !IsIssueStale("in_progress", updatedAt, later, 24*3_600_000) {
		t.Fatal("expected stale")
	}
	if IsIssueStale("in_progress", updatedAt, exact, 24*3_600_000) {
		t.Fatal("equal duration was stale")
	}
	for _, status := range []string{"backlog", "todo", "done", "canceled"} {
		if IsIssueStale(status, updatedAt, later, 3_600_000) {
			t.Fatal(status)
		}
	}
	if IsIssueStale("in_progress", "", later, 3_600_000) || IsIssueStale("in_progress", "t", later, 3_600_000) {
		t.Fatal("broken timestamp was stale")
	}
}

func TestStaleAfterRejects(t *testing.T) {
	issueSkipWithoutDocument(t)
	for _, value := range []string{"24", "1w", "-1h", "0h", "h", "1.5h", "nope"} {
		_, err := ParseStaleAfter(value)
		expected := `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual "` + value + `"`
		if value == "nope" {
			expected = `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual "nope"`
		}
		if err == nil || err.Error() != expected {
			t.Fatalf("%q: %v", value, err)
		}
	}
	_, err := ParseStaleAfter(`say "hi"`)
	if err == nil || err.Error() != `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual "say \"hi\""` {
		t.Fatal(err)
	}
}

func TestParentAndBlocks(t *testing.T) {
	all := []Issue{bareIssue("1"), bareIssue("2"), bareIssue("3")}
	all[1].Parent = issueStringPointer("1")
	parent, err := issueResolveParent("3", Present("1"), all)
	if err != nil || parent == nil || *parent != "1" {
		t.Fatal(err)
	}
	cleared, err := issueResolveParent("2", Present("none"), all)
	if err != nil || cleared != nil {
		t.Fatal("none parent was not cleared")
	}
	_, err = issueResolveParent("1", Present("1"), all)
	if err == nil || err.Error() != "invalid parent: an issue cannot be its own parent, actual 1" {
		t.Fatal(err)
	}
	_, err = issueResolveParent("4", Present("9"), append(all, bareIssue("4")))
	if err == nil || err.Error() != "invalid parent: issue not found: 9" {
		t.Fatal(err)
	}
	_, err = issueResolveParent("1", Present("2"), all)
	if err == nil || err.Error() != "invalid parent: cycle: 2 is a descendant of 1" {
		t.Fatal(err)
	}

	relations, err := issueResolveBlocks("1", nil, SaveInput{AddBlocks: Present([]string{"2"})}, all)
	if err != nil || issueJoinIDs(relations.blocks) != "2" {
		t.Fatal(err, relations.blocks)
	}
	relations, err = issueResolveBlocks("1", []string{"2", "3"}, SaveInput{Blocks: Present([]string{"3", "3"})}, all)
	if err != nil || issueJoinIDs(relations.blocks) != "3" {
		t.Fatal(relations.blocks, err)
	}
	_, err = issueResolveBlocks("1", nil, SaveInput{AddBlocks: Present([]string{"1"})}, all)
	if err == nil || err.Error() != "invalid block: an issue cannot block itself, actual 1" {
		t.Fatal(err)
	}
	_, err = issueResolveBlocks("1", nil, SaveInput{AddBlocks: Present([]string{"9"})}, all)
	if err == nil || err.Error() != "invalid block: issue not found: 9" {
		t.Fatal(err)
	}
	blocking := []Issue{bareIssue("1"), bareIssue("2")}
	blocking[0].Blocks = []string{"2"}
	_, err = issueResolveBlocks("2", nil, SaveInput{AddBlocks: Present([]string{"1"})}, blocking)
	if err == nil || err.Error() != "invalid block: cycle: 2 already blocked by 1" {
		t.Fatal(err)
	}
	_, err = issueResolveBlocks("1", nil, SaveInput{Blocks: Present([]string{"2"}), AddBlocks: Present([]string{"3"})}, all)
	if err == nil || err.Error() != "cannot pass blocks with addBlocks, removeBlocks, addBlockedBy, or removeBlockedBy" {
		t.Fatal(err)
	}
	// 辺が既にあっても addBlockedBy は相手を所有者に入れる。updatedAt を進めるのは書き込み側 (src/store.ts:571-588)。
	relations, err = issueResolveBlocks("4", nil, SaveInput{AddBlockedBy: Present([]string{"3", "3"})}, []Issue{bareIssue("3"), bareIssue("4")})
	if err != nil || len(relations.owners) != 1 || relations.owners[0].id != "3" || issueJoinIDs(relations.owners[0].blocks) != "4" {
		t.Fatalf("%+v %v", relations, err)
	}
	already := []Issue{bareIssue("3"), bareIssue("4")}
	already[0].Blocks = []string{"4"}
	relations, err = issueResolveBlocks("4", nil, SaveInput{AddBlockedBy: Present([]string{"3"})}, already)
	if err != nil || len(relations.owners) != 1 || issueJoinIDs(relations.owners[0].blocks) != "4" {
		t.Fatalf("repeat: %+v %v", relations, err)
	}
}

func TestStatusTimestamps(t *testing.T) {
	created := issueStatusTimestamps(nil, "todo", "2026-09-25T09:00:00.000Z")
	if created.startedAt != nil || created.completedAt != nil || created.canceledAt != nil {
		t.Fatal("todo created with timestamps")
	}
	done := issueStatusTimestamps(nil, "done", "2026-09-25T09:00:00.000Z")
	if done.startedAt != nil || done.completedAt == nil || *done.completedAt != "2026-09-25T09:00:00.000Z" {
		t.Fatal("create as done")
	}
	current := bareIssue("1")
	current.Status = "todo"
	started := issueStatusTimestamps(&current, "in_progress", "T1")
	if started.startedAt == nil || *started.startedAt != "T1" {
		t.Fatal("startedAt")
	}
	current.Status = "in_progress"
	current.StartedAt = issueStringPointer("T1")
	finished := issueStatusTimestamps(&current, "done", "T2")
	if finished.startedAt == nil || *finished.startedAt != "T1" || finished.completedAt == nil || *finished.completedAt != "T2" {
		t.Fatal("done keeps startedAt")
	}
	current.Status = "done"
	current.CompletedAt = issueStringPointer("T2")
	reopened := issueStatusTimestamps(&current, "todo", "T3")
	if reopened.startedAt == nil || *reopened.startedAt != "T1" || reopened.completedAt != nil {
		t.Fatal("reopen cleared completedAt")
	}
}

func TestDiffIssue(t *testing.T) {
	before := bareIssue("1")
	before.Status = "todo"
	after := before
	after.Status = "in_progress"
	after.Labels = []string{"ui", "web"}
	after.Priority = issueStringPointer("high")
	after.Body = "text"
	changes := DiffIssue(before, after)
	if len(changes) != 3 || changes[0].Field != "status" || changes[1].Field != "labels" || changes[2].Field != "priority" {
		t.Fatalf("%+v", changes)
	}
	if DiffIssue(before, before) != nil && len(DiffIssue(before, before)) != 0 {
		t.Fatal("unchanged issue produced events")
	}
	renamed := before
	renamed.Title = "b\nc"
	title := DiffIssue(before, renamed)
	if len(title) != 1 || title[0].To != "b\nc" {
		t.Fatalf("title event lost the newline: %+v", title)
	}
}

func TestApplyPatch(t *testing.T) {
	ops, err := ParsePatch([]any{
		map[string]any{"op": "replace", "old_string": "beta", "new_string": "BETA"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := issueApplyPatch("alpha\nbeta\ngamma", ops)
	if err != nil || got != "alpha\nBETA\ngamma" {
		t.Fatal(got, err)
	}
	ops, err = ParsePatch([]any{
		map[string]any{"op": "replace", "old_string": "foo", "new_string": "baz", "replace_all": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err = issueApplyPatch("foo bar foo", ops)
	if err != nil || got != "baz bar baz" {
		t.Fatal(got, err)
	}
	ops, err = ParsePatch([]any{map[string]any{"op": "replace", "old_string": "foo", "new_string": "baz"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = issueApplyPatch("foo bar foo", ops)
	if err == nil || err.Error() != "patch replace: old_string must match the current body exactly once, expected 1 match, actual 2" {
		t.Fatal(err)
	}
	_, err = issueApplyPatch("only", ops)
	if err == nil || err.Error() != "patch replace: old_string must match the current body exactly once, expected 1 match, actual 0" {
		t.Fatal(err)
	}
	ops, err = ParsePatch([]any{
		map[string]any{"op": "insert_before", "anchor": "middle", "text": "before\n"},
		map[string]any{"op": "insert_after", "anchor": "middle", "text": "\nafter"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err = issueApplyPatch("middle", ops)
	if err != nil || got != "before\nmiddle\nafter" {
		t.Fatal(got, err)
	}
	ops, err = ParsePatch([]any{
		map[string]any{"op": "prepend", "text": "start\n"},
		map[string]any{"op": "append", "text": "\nend"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err = issueApplyPatch("core", ops)
	if err != nil || got != "start\ncore\nend" {
		t.Fatal(got, err)
	}
	ops, err = ParsePatch([]any{
		map[string]any{"op": "replace_range", "from": "hello ", "to": " foo", "new_string": "hi"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err = issueApplyPatch("hello WORLD foo", ops)
	if err != nil || got != "hi foo" {
		t.Fatal(got, err)
	}
	_, err = ParsePatch([]any{})
	if err == nil || err.Error() != "invalid patch: expected 1 to 50 operations, actual 0" {
		t.Fatal(err)
	}
	_, err = ParsePatch(map[string]any{"op": "replace"})
	if err == nil || err.Error() != "invalid patch: expected a JSON array of operations, actual object" {
		t.Fatal(err)
	}
	_, err = ParsePatch([]any{map[string]any{"op": "splice", "text": "x"}})
	if err == nil || err.Error() != "invalid patch: expected op replace, insert_before, insert_after, prepend, append, or replace_range, actual splice" {
		t.Fatal(err)
	}
	_, err = ParsePatch([]any{map[string]any{"op": "replace"}})
	if err == nil || err.Error() != "invalid patch replace: old_string must be a non-empty string, actual undefined" {
		t.Fatal(err)
	}
	_, err = ParsePatch([]any{nil})
	if err == nil || err.Error() != "invalid patch: expected an operation object, actual null" {
		t.Fatal(err)
	}
	_, err = issueApplyPatch("alpha\nbeta", issueMustPatch(t, []any{
		map[string]any{"op": "replace", "old_string": "alpha", "new_string": "ALPHA"},
		map[string]any{"op": "replace", "old_string": "missing", "new_string": "x"},
	}))
	if err == nil || err.Error() != "patch replace: old_string must match the current body exactly once, expected 1 match, actual 0" {
		t.Fatal(err)
	}
}

func TestParsePatchQuotesStrings(t *testing.T) {
	issueSkipWithoutDocument(t)
	_, err := ParsePatch([]any{map[string]any{"op": "replace", "old_string": "", "new_string": "a"}})
	if err == nil || err.Error() != `invalid patch replace: old_string must be a non-empty string, actual ""` {
		t.Fatal(err)
	}
	_, err = ParsePatch([]any{"x"})
	if err == nil || err.Error() != `invalid patch: expected an operation object, actual "x"` {
		t.Fatal(err)
	}
	_, err = ParsePatch(issueAbsent{})
	if err == nil || err.Error() != "invalid patch: expected a JSON array of operations, actual undefined" {
		t.Fatal(err)
	}
}

func TestNextIssueID(t *testing.T) {
	space := issueTestWorkspace(t)
	first, err := nextIssueID(space)
	if err != nil || first != "1" {
		t.Fatal(first, err)
	}
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "5.md"), "x")
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "01.md"), "x")
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "notes.md"), "x")
	next, err := nextIssueID(space)
	if err != nil || next != "6" {
		t.Fatalf("next id: %s %v", next, err)
	}
}

func TestWriteCreateAndReplace(t *testing.T) {
	space := issueTestWorkspace(t)
	path := filepath.Join(space.Directory, "issues", "1.md")
	if err := issueWriteCreate(path, "one"); err != nil {
		t.Fatal(err)
	}
	if err := issueWriteCreate(path, "two"); err == nil || !issueIsExist(err) {
		t.Fatal(err)
	}
	if err := issueWriteReplace(path, "replaced"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "replaced" {
		t.Fatal(string(content), err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("temp file remained")
	}
	issueNoTemporaryFiles(t, filepath.Dir(path))
}

func TestIssueEventsReader(t *testing.T) {
	space := issueTestWorkspace(t)
	_, err := IssueEvents(context.Background(), space, "9")
	if err == nil || err.Error() != "issue not found: 9" {
		t.Fatal(err)
	}
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "1.md"), "x")
	events, err := IssueEvents(context.Background(), space, "1")
	if err != nil || len(events) != 0 {
		t.Fatal(events, err)
	}
	payload := "{\"field\":\"status\",\"from\":\"in_progress\",\"to\":\"done\",\"by\":\"Spec Author\",\"session\":\"session-1\",\"at\":\"2026-09-25T10:00:00.000Z\"}\n{broken\n\n{\"field\":\"nope\"}\n{\"field\":\"labels\",\"from\":[],\"to\":[\"ui\",\"本番\"],\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T09:00:00.000Z\",\"extra\":true}\n"
	issueWriteFile(t, filepath.Join(space.Directory, "events", "1.jsonl"), payload)
	events, err = IssueEvents(context.Background(), space, "1")
	if err != nil || len(events) != 2 {
		t.Fatalf("%+v %v", events, err)
	}
	if events[0].Field != "status" || events[0].To != "done" || events[0].Session == nil || *events[0].Session != "session-1" {
		t.Fatalf("first: %+v", events[0])
	}
	labels, ok := events[1].To.([]string)
	if !ok || len(labels) != 2 || labels[1] != "本番" || events[1].Session != nil {
		t.Fatalf("labels: %+v", events[1])
	}
	kept, err := os.ReadFile(filepath.Join(space.Directory, "events", "1.jsonl"))
	if err != nil || string(kept) != payload {
		t.Fatal("broken lines were rewritten")
	}
}

func TestAppendIssueEventsSkipsEmpty(t *testing.T) {
	space := issueTestWorkspace(t)
	if err := AppendIssueEvents(context.Background(), space, "1", nil, IssueEventContext{By: "Spec Author", At: "2026-09-25T09:00:00.000Z"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(space.Directory, "events")); !os.IsNotExist(err) {
		t.Fatal("events directory was created")
	}
}

func TestFilterMatch(t *testing.T) {
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.Local)
	late := bareIssue("1")
	late.Title = "past"
	late.DueDate = issueStringPointer("2026-09-27")
	today := bareIssue("2")
	today.DueDate = issueStringPointer("2026-09-28")
	shipped := bareIssue("3")
	shipped.Status = "done"
	shipped.DueDate = issueStringPointer("2026-09-27")
	child := bareIssue("4")
	child.Parent = issueStringPointer("1")
	child.Assignee = issueStringPointer("Ada")
	child.Labels = []string{"cli"}
	child.Body = "search me"
	overdue, err := issueResolveListFilter(Filter{Due: Present("overdue")}, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	matched := filterIssues([]Issue{late, today, shipped, child}, overdue, now)
	if issueIds(matched) != "1" {
		t.Fatalf("overdue: %s", issueIds(matched))
	}
	parent, err := issueResolveListFilter(Filter{Parent: Present("none")}, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	if issueIds(filterIssues([]Issue{late, child}, parent, now)) != "1" {
		t.Fatal("parent none")
	}
	unassigned, err := issueResolveListFilter(Filter{Assignee: Present("none")}, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	if issueIds(filterIssues([]Issue{late, child}, unassigned, now)) != "1" {
		t.Fatal("assignee none")
	}
	query, err := issueResolveListFilter(Filter{Query: Present("SEARCH")}, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	if issueIds(filterIssues([]Issue{late, child}, query, now)) != "4" {
		t.Fatal("query")
	}
	label, err := issueResolveListFilter(Filter{Label: Present("cli")}, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	if issueIds(filterIssues([]Issue{late, child}, label, now)) != "4" {
		t.Fatal("label")
	}
	_, err = issueResolveListFilter(Filter{Status: Present("nope")}, "Spec Author")
	if err == nil || err.Error() != "invalid status: expected backlog, todo, in_progress, done, or canceled, actual nope" {
		t.Fatal(err)
	}
}

func TestReadStaleAfter(t *testing.T) {
	space := issueTestWorkspace(t)
	got, err := ReadStaleAfter(context.Background(), space)
	if err != nil || got != DefaultStaleAfterMilliseconds {
		t.Fatal(got, err)
	}
	issueWriteFile(t, filepath.Join(space.Directory, "config.yml"), "notify: echo x\nstaleAfter: 90m\n")
	got, err = ReadStaleAfter(context.Background(), space)
	if err != nil || got != 90*60_000 {
		t.Fatal(got, err)
	}
	issueWriteFile(t, filepath.Join(space.Directory, "config.yml"), "staleAfter:\nnotify: x\n")
	got, err = ReadStaleAfter(context.Background(), space)
	if err != nil || got != DefaultStaleAfterMilliseconds {
		t.Fatal("empty staleAfter should fall through to the default", got, err)
	}
}

func TestLoadRawIssuesSkipsCorruptFiles(t *testing.T) {
	space := issueTestWorkspace(t)
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "1.md"), specDoneIssue)
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "2.md"), "not an issue")
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "3.md"), "---\nid: 3\ntitle: bad\nstatus: nope\nassignee:\nlabels:\n---\n\nx\n")
	issues, err := loadRawIssues(space, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 || issues[0].ID != "1" {
		t.Fatalf("kept %s", issueIds(issues))
	}
	_, err = readIssue(filepath.Join(space.Directory, "issues", "2.md"), "2", "Spec Author")
	if err == nil || err.Error() != "invalid issue file" {
		t.Fatal(err)
	}
	_, err = readIssue(filepath.Join(space.Directory, "issues", "3.md"), "3", "Spec Author")
	if err == nil || err.Error() != "invalid status: expected backlog, todo, in_progress, done, or canceled, actual nope" {
		t.Fatal(err)
	}
}

func TestFormatAndParseIssueMatchTheSpec(t *testing.T) {
	formatted := formatIssue(issueSpecDoneMemory())
	if formatted != specDoneIssue {
		t.Fatalf("format\nexpected:\n%s\nactual:\n%s", specDoneIssue, formatted)
	}
	parsed, err := parseIssue(specDoneIssue, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Title != `本番: "称号" #1` || parsed.Status != "done" || parsed.Assignee == nil || *parsed.Assignee != "Spec Author" {
		t.Fatalf("parsed header: %+v", parsed)
	}
	if issueJoinIDs(parsed.Labels) != "ui,本番" || parsed.DueDate == nil || *parsed.DueDate != "2026-10-01" || parsed.Priority == nil || *parsed.Priority != "high" {
		t.Fatalf("parsed fields: %+v", parsed)
	}
	if parsed.Body != "1 行目\n\n2 行目\n" || parsed.Parent != nil || len(parsed.Blocks) != 0 {
		t.Fatalf("parsed body: %+v", parsed)
	}
	if parsed.Session == nil || *parsed.Session != "session-1" || parsed.StartedAt == nil || parsed.CompletedAt == nil {
		t.Fatalf("parsed times: %+v", parsed)
	}
	child := formatIssue(issueSpecChildMemory())
	if child != specChildIssue {
		t.Fatalf("child\nexpected:\n%s\nactual:\n%s", specChildIssue, child)
	}
	newline := issueSpecDoneMemory()
	newline.Title = "b\nc"
	if !issueContainsLine(formatIssue(newline), "title: b c") {
		t.Fatal(formatIssue(newline))
	}
}

func TestAppendIssueEventBytes(t *testing.T) {
	space := issueTestWorkspace(t)
	err := AppendIssueEvents(context.Background(), space, "1", []IssueChange{{
		Field: "status",
		From:  "in_progress",
		To:    "done",
	}}, IssueEventContext{By: "Spec Author", Session: issueStringPointer("session-1"), At: "2026-09-25T10:00:00.000Z"})
	if err != nil {
		t.Fatal(err)
	}
	issueExpectFile(t, filepath.Join(space.Directory, "events", "1.jsonl"), "{\"field\":\"status\",\"from\":\"in_progress\",\"to\":\"done\",\"by\":\"Spec Author\",\"session\":\"session-1\",\"at\":\"2026-09-25T10:00:00.000Z\"}\n")
	err = AppendIssueEvents(context.Background(), space, "2", []IssueChange{{
		Field: "labels",
		From:  []string{},
		To:    []string{"ui", "本番"},
	}}, IssueEventContext{By: "Spec Author", At: "2026-09-25T09:00:00.000Z"})
	if err != nil {
		t.Fatal(err)
	}
	issueExpectFile(t, filepath.Join(space.Directory, "events", "2.jsonl"), "{\"field\":\"labels\",\"from\":[],\"to\":[\"ui\",\"本番\"],\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T09:00:00.000Z\"}\n")
	err = AppendIssueEvents(context.Background(), space, "3", []IssueChange{{
		Field: "title",
		From:  "a",
		To:    "b\nc",
	}}, IssueEventContext{By: "Spec Author", At: "2026-09-25T09:00:00.000Z"})
	if err != nil {
		t.Fatal(err)
	}
	issueExpectFile(t, filepath.Join(space.Directory, "events", "3.jsonl"), "{\"field\":\"title\",\"from\":\"a\",\"to\":\"b\\nc\",\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T09:00:00.000Z\"}\n")
	err = AppendIssueEvents(context.Background(), space, "3", []IssueChange{{
		Field: "blocks",
		From:  []string{},
		To:    []string{"4"},
	}}, IssueEventContext{By: "Spec Author", At: "2026-09-25T12:00:00.000Z"})
	if err != nil {
		t.Fatal(err)
	}
	kept, err := os.ReadFile(filepath.Join(space.Directory, "events", "3.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if string(kept) != "{\"field\":\"title\",\"from\":\"a\",\"to\":\"b\\nc\",\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T09:00:00.000Z\"}\n{\"field\":\"blocks\",\"from\":[],\"to\":[\"4\"],\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T12:00:00.000Z\"}\n" {
		t.Fatalf("appended events:\n%s", kept)
	}
}

func TestListAndGetDeriveRelations(t *testing.T) {
	space := issueTestWorkspace(t)
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.Local)
	parent := issueSpecDoneMemory()
	parent.Status = "todo"
	parent.StartedAt = nil
	parent.CompletedAt = nil
	parent.DueDate = issueStringPointer("2026-09-01")
	parent.UpdatedAt = "2026-09-25T10:00:00.000Z"
	child := issueSpecChildMemory()
	child.Status = "in_progress"
	child.StartedAt = issueStringPointer("2026-09-20T00:00:00.000Z")
	child.UpdatedAt = "2026-09-20T00:00:00.000Z"
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "1.md"), formatIssue(parent))
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "2.md"), formatIssue(child))
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "9.md"), "not an issue")
	listed, err := ListIssues(context.Background(), space, Filter{}, now, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	if issueIds(listed) != "1,2" {
		t.Fatalf("list: %s", issueIds(listed))
	}
	if !listed[1].Stale || listed[0].Stale {
		t.Fatalf("stale: %+v %+v", listed[0].Stale, listed[1].Stale)
	}
	if issueJoinIDs(listed[0].Children) != "2" || issueJoinIDs(listed[0].BlockedBy) != "2" {
		t.Fatalf("derived: %+v", listed[0])
	}
	overdue, err := ListIssues(context.Background(), space, Filter{Due: Present("overdue")}, now, "Spec Author")
	if err != nil || issueIds(overdue) != "1" {
		t.Fatalf("overdue: %s %v", issueIds(overdue), err)
	}
	children, err := ListIssues(context.Background(), space, Filter{Parent: Present("1")}, now, "Spec Author")
	if err != nil || issueIds(children) != "2" {
		t.Fatal(issueIds(children), err)
	}
	got, err := GetIssue(context.Background(), space, "2", now, "Spec Author")
	if err != nil || got.Parent == nil || *got.Parent != "1" || !got.Stale || issueJoinIDs(got.Blocks) != "1" {
		t.Fatalf("%+v %v", got, err)
	}
	page, err := PageIssues(listed, PageOptions{Limit: 1})
	if err != nil || issueIds(page.Issues) != "1" || !page.HasNextPage || page.Cursor == nil || *page.Cursor != "1" {
		t.Fatalf("page: %+v %v", page, err)
	}
}

func TestSaveIssueBytes(t *testing.T) {
	issueSkipWithoutGitName(t)
	space := issueGitWorkspace(t)
	provenance := &Provenance{
		Session:  issueStringPointer("session-1"),
		Worktree: issueStringPointer("/work/feature"),
		Branch:   issueStringPointer("feat/add-thing"),
	}
	createdAt := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	doneAt := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
	_, err := SaveIssue(context.Background(), space, SaveInput{
		Title:    Present(`本番: "称号" #1`),
		Status:   Present("in_progress"),
		Assignee: Present("Spec Author"),
		Labels:   Present([]string{"ui", "本番"}),
		DueDate:  Present("2026-10-01"),
		Priority: Present("high"),
		Body:     Present("1 行目\n\n2 行目\n"),
	}, SaveOptions{Author: "Spec Author", Now: createdAt, Provenance: provenance})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(space.Directory, "events")); !os.IsNotExist(err) {
		t.Fatal("create wrote an event")
	}
	done, err := SaveIssue(context.Background(), space, SaveInput{ID: "1", Status: Present("done")}, SaveOptions{Author: "Spec Author", Now: doneAt, Provenance: provenance})
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "done" || done.Body != "1 行目\n\n2 行目\n" {
		t.Fatalf("%+v", done)
	}
	issueExpectFile(t, filepath.Join(space.Directory, "issues", "1.md"), specDoneIssue)
	issueExpectFile(t, filepath.Join(space.Directory, "events", "1.jsonl"), "{\"field\":\"status\",\"from\":\"in_progress\",\"to\":\"done\",\"by\":\"Spec Author\",\"session\":\"session-1\",\"at\":\"2026-09-25T10:00:00.000Z\"}\n")
}

func TestSaveIssueChildAndBlockedBy(t *testing.T) {
	issueSkipWithoutGitName(t)
	space := issueGitWorkspace(t)
	provenance := &Provenance{
		Session:  issueStringPointer("session-1"),
		Worktree: issueStringPointer("/work/feature"),
		Branch:   issueStringPointer("feat/add-thing"),
	}
	createdAt := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	updatedAt := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	if _, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("parent")}, SaveOptions{Author: "Spec Author", Now: createdAt, Provenance: provenance}); err != nil {
		t.Fatal(err)
	}
	child, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("child"), Parent: Present("1"), AddBlocks: Present([]string{"1"})}, SaveOptions{Author: "Spec Author", Now: createdAt, Provenance: provenance})
	if err != nil {
		t.Fatal(err)
	}
	if child.Parent == nil || *child.Parent != "1" || issueJoinIDs(child.Blocks) != "1" {
		t.Fatalf("child: %+v", child)
	}
	issueExpectFile(t, filepath.Join(space.Directory, "issues", "2.md"), specChildIssue)
	parent, err := GetIssue(context.Background(), space, "1", createdAt, "Spec Author")
	if err != nil || issueJoinIDs(parent.Children) != "2" || issueJoinIDs(parent.BlockedBy) != "2" {
		t.Fatalf("%+v %v", parent, err)
	}
	ownerAt := createdAt
	if _, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("owner")}, SaveOptions{Author: "Spec Author", Now: ownerAt}); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("blocked")}, SaveOptions{Author: "Spec Author", Now: ownerAt}); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveIssue(context.Background(), space, SaveInput{ID: "4", AddBlockedBy: Present([]string{"3"})}, SaveOptions{Author: "Spec Author", Now: updatedAt}); err != nil {
		t.Fatal(err)
	}
	issueExpectFile(t, filepath.Join(space.Directory, "issues", "3.md"), specOwnerIssue)
	issueExpectFile(t, filepath.Join(space.Directory, "events", "3.jsonl"), "{\"field\":\"blocks\",\"from\":[],\"to\":[\"4\"],\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T12:00:00.000Z\"}\n")
	later := time.Date(2026, 9, 25, 13, 0, 0, 0, time.UTC)
	if _, err := SaveIssue(context.Background(), space, SaveInput{ID: "4", AddBlockedBy: Present([]string{"3"})}, SaveOptions{Author: "Spec Author", Now: later}); err != nil {
		t.Fatal(err)
	}
	owner, err := GetIssue(context.Background(), space, "3", later, "Spec Author")
	if err != nil || owner.UpdatedAt != "2026-09-25T13:00:00.000Z" || issueJoinIDs(owner.Blocks) != "4" {
		t.Fatalf("repeat blockedBy: %+v %v", owner, err)
	}
	issueExpectFile(t, filepath.Join(space.Directory, "events", "3.jsonl"), "{\"field\":\"blocks\",\"from\":[],\"to\":[\"4\"],\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T12:00:00.000Z\"}\n")
}

func TestSaveIssueTitleNewlineAndLabels(t *testing.T) {
	issueSkipWithoutGitName(t)
	space := issueGitWorkspace(t)
	now := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	if _, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("a")}, SaveOptions{Author: "Spec Author", Now: now}); err != nil {
		t.Fatal(err)
	}
	updated, err := SaveIssue(context.Background(), space, SaveInput{ID: "1", Title: Present("b\nc")}, SaveOptions{Author: "Spec Author", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "b c" {
		t.Fatalf("read title: %q", updated.Title)
	}
	events, err := IssueEvents(context.Background(), space, "1")
	if err != nil || len(events) != 1 || events[0].To != "b\nc" {
		t.Fatalf("%+v %v", events, err)
	}
	eventText, err := os.ReadFile(filepath.Join(space.Directory, "events", "1.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if string(eventText) != "{\"field\":\"title\",\"from\":\"a\",\"to\":\"b\\nc\",\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T09:00:00.000Z\"}\n" {
		t.Fatalf("event bytes: %s", eventText)
	}
	saved, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("labels"), Labels: Present([]string{" a ", "a, b", "c"})}, SaveOptions{Author: "Spec Author", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if issueJoinIDs(saved.Labels) != "a,a,b,c" {
		t.Fatalf("labels read: %v", saved.Labels)
	}
	text, err := os.ReadFile(filepath.Join(space.Directory, "issues", saved.ID+".md"))
	if err != nil {
		t.Fatal(err)
	}
	if !issueContainsLine(string(text), "labels:  a , a, b, c") {
		t.Fatalf("label line missing:\n%s", text)
	}
}

func TestSaveIssueErrorsLeaveFilesUntouched(t *testing.T) {
	issueSkipWithoutGitName(t)
	space := issueGitWorkspace(t)
	now := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	_, err := SaveIssue(context.Background(), space, SaveInput{DueDate: Present("2026-02-30")}, SaveOptions{Author: "Spec Author", Now: now})
	if err == nil || err.Error() != "invalid dueDate: expected YYYY-MM-DD, actual 2026-02-30" {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(filepath.Join(space.Directory, "issues", "1.md")); !os.IsNotExist(statErr) {
		t.Fatal("invalid due date created a file")
	}
	_, err = SaveIssue(context.Background(), space, SaveInput{}, SaveOptions{Author: "Spec Author", Now: now})
	if err == nil || err.Error() != "title is required when creating an issue" {
		t.Fatal(err)
	}
	_, err = SaveIssue(context.Background(), space, SaveInput{Title: Present("   ")}, SaveOptions{Author: "Spec Author", Now: now})
	if err == nil || err.Error() != "title is required when creating an issue" {
		t.Fatal(err)
	}
	if _, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("keep")}, SaveOptions{Author: "Spec Author", Now: now}); err != nil {
		t.Fatal(err)
	}
	_, err = SaveIssue(context.Background(), space, SaveInput{ID: "1", Title: Present("  ")}, SaveOptions{Author: "Spec Author", Now: now})
	if err == nil || err.Error() != `invalid title: expected a non-empty string, actual "  "` {
		t.Fatal(err)
	}
	kept, err := GetIssue(context.Background(), space, "1", now, "Spec Author")
	if err != nil || kept.Title != "keep" {
		t.Fatal(kept.Title, err)
	}
	_, err = SaveIssue(context.Background(), space, SaveInput{ID: "7", Title: Present("explicit")}, SaveOptions{Author: "Spec Author", Now: now})
	if err == nil || err.Error() != "issue not found: 7" {
		t.Fatal(err)
	}
	_, err = SaveIssue(context.Background(), space, SaveInput{ID: "1", Body: Present("new"), PatchSet: true, Patch: []any{map[string]any{"op": "append", "text": "!"}}}, SaveOptions{Author: "Spec Author", Now: now})
	if err == nil || err.Error() != "cannot pass body and patch together" {
		t.Fatal(err)
	}
	_, err = SaveIssue(context.Background(), space, SaveInput{Title: Present("x"), PatchSet: true, Patch: []any{map[string]any{"op": "append", "text": "!"}}}, SaveOptions{Author: "Spec Author", Now: now})
	if err == nil || err.Error() != "patch is only valid when updating an existing issue" {
		t.Fatal(err)
	}
	issueWriteFile(t, filepath.Join(space.Directory, "config.yml"), "staleAfter: nope\n")
	before, err := os.ReadDir(filepath.Join(space.Directory, "issues"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = SaveIssue(context.Background(), space, SaveInput{Title: Present("task")}, SaveOptions{Author: "Spec Author", Now: now})
	if err == nil || err.Error() != `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual "nope"` {
		t.Fatal(err)
	}
	after, err := os.ReadDir(filepath.Join(space.Directory, "issues"))
	if err != nil || len(after) != len(before) {
		t.Fatal("broken staleAfter wrote an issue")
	}
}

func TestSaveIssueKeepsProvenanceAndAssigneeMe(t *testing.T) {
	issueSkipWithoutGitName(t)
	space := issueGitWorkspace(t)
	now := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	provenance := &Provenance{Session: issueStringPointer("session-1"), Worktree: issueStringPointer("/work/feature"), Branch: issueStringPointer("feat/add-thing")}
	created, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("task"), Assignee: Present("me")}, SaveOptions{Author: "Spec Author", Now: now, Provenance: provenance})
	if err != nil {
		t.Fatal(err)
	}
	if created.Assignee == nil || *created.Assignee != "Spec Author" {
		t.Fatalf("assignee: %v", created.Assignee)
	}
	if created.Session == nil || *created.Session != "session-1" || created.Branch == nil || *created.Branch != "feat/add-thing" {
		t.Fatalf("provenance: %+v", created)
	}
	updated, err := SaveIssue(context.Background(), space, SaveInput{ID: "1", Status: Present("done")}, SaveOptions{Author: "Spec Author", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Session == nil || *updated.Session != "session-1" || updated.Worktree == nil || *updated.Worktree != "/work/feature" {
		t.Fatalf("provenance was cleared: %+v", updated)
	}
	none, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("none")}, SaveOptions{Author: "Spec Author", Now: now, Provenance: &Provenance{Session: issueStringPointer("none"), Worktree: issueStringPointer("none"), Branch: issueStringPointer("none")}})
	if err != nil {
		t.Fatal(err)
	}
	if none.Session != nil || none.Worktree != nil || none.Branch != nil {
		t.Fatalf("none was kept in memory: %+v", none)
	}
	text, err := os.ReadFile(filepath.Join(space.Directory, "issues", none.ID+".md"))
	if err != nil {
		t.Fatal(err)
	}
	if !issueContainsLine(string(text), "session: none") || !issueContainsLine(string(text), "worktree: none") || !issueContainsLine(string(text), "branch: none") {
		t.Fatalf("file cleared none:\n%s", text)
	}
}

func TestListSkipsCorruptAndUsesFilenameID(t *testing.T) {
	issueSkipWithoutGitName(t)
	space := issueGitWorkspace(t)
	now := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	if _, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("ok")}, SaveOptions{Author: "Spec Author", Now: now}); err != nil {
		t.Fatal(err)
	}
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "9.md"), "not an issue")
	issueWriteFile(t, filepath.Join(space.Directory, "issues", "01.md"), "---\nid: 99\ntitle: padded\nstatus: todo\nassignee:\nlabels:\ncreatedAt: t\nupdatedAt: t\n---\n\nx\n")
	listed, err := ListIssues(context.Background(), space, Filter{}, now, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, issue := range listed {
		found[issue.ID] = true
	}
	if !found["1"] || !found["01"] || found["9"] {
		t.Fatalf("ids: %s", issueIds(listed))
	}
	padded, err := GetIssue(context.Background(), space, "01", now, "Spec Author")
	if err != nil || padded.ID != "01" {
		t.Fatal(padded.ID, err)
	}
	_, err = GetIssue(context.Background(), space, "9", now, "Spec Author")
	if err == nil || err.Error() != "invalid issue file" {
		t.Fatal(err)
	}
	next, err := SaveIssue(context.Background(), space, SaveInput{Title: Present("next")}, SaveOptions{Author: "Spec Author", Now: now})
	if err != nil || next.ID != "10" {
		t.Fatalf("next: %+v %v", next, err)
	}
}

func TestErrorKinds(t *testing.T) {
	space := issueTestWorkspace(t)
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	_, err := GetIssue(context.Background(), space, "missing", now, "Spec Author")
	if err == nil || err.Error() != "issue not found: missing" || !errors.Is(err, errs.ErrNotFound) {
		t.Fatal(err)
	}
	_, err = ResolvePriority(Present("nope"))
	if err == nil || err.Error() != "invalid priority: expected urgent, high, medium, or low, actual nope" || !errors.Is(err, errs.ErrInvalidArgument) {
		t.Fatal(err)
	}
}

func TestConcurrentSaveKeepsBothFields(t *testing.T) {
	space := issueTestWorkspace(t)
	now := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	ctx := context.Background()
	if _, err := SaveIssue(ctx, space, SaveInput{Title: Present("start"), Status: Present("todo")}, SaveOptions{Author: "Spec Author", Now: now}); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	errorChannel := make(chan error, 2)
	wait.Add(2)
	go func() {
		defer wait.Done()
		_, err := SaveIssue(ctx, space, SaveInput{ID: "1", Title: Present("renamed")}, SaveOptions{Author: "Spec Author", Now: now})
		errorChannel <- err
	}()
	go func() {
		defer wait.Done()
		_, err := SaveIssue(ctx, space, SaveInput{ID: "1", Status: Present("done")}, SaveOptions{Author: "Spec Author", Now: now})
		errorChannel <- err
	}()
	wait.Wait()
	close(errorChannel)
	for err := range errorChannel {
		if err != nil {
			t.Fatal(err)
		}
	}
	got, err := GetIssue(ctx, space, "1", now, "Spec Author")
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "renamed" || got.Status != "done" {
		t.Fatalf("lost update: title %q status %q", got.Title, got.Status)
	}
	issueNoTemporaryFiles(t, filepath.Join(space.Directory, "issues"))
}

const specDoneIssue = "" +
	"---\n" +
	"id: 1\n" +
	"title: 本番: \"称号\" #1\n" +
	"status: done\n" +
	"assignee: Spec Author\n" +
	"labels: ui, 本番\n" +
	"dueDate: 2026-10-01\n" +
	"priority: high\n" +
	"parent:\n" +
	"blocks:\n" +
	"startedAt: 2026-09-25T09:00:00.000Z\n" +
	"completedAt: 2026-09-25T10:00:00.000Z\n" +
	"canceledAt:\n" +
	"createdAt: 2026-09-25T09:00:00.000Z\n" +
	"updatedAt: 2026-09-25T10:00:00.000Z\n" +
	"session: session-1\n" +
	"worktree: /work/feature\n" +
	"branch: feat/add-thing\n" +
	"---\n" +
	"\n" +
	"1 行目\n" +
	"\n" +
	"2 行目\n" +
	"\n"

const specChildIssue = "" +
	"---\n" +
	"id: 2\n" +
	"title: child\n" +
	"status: todo\n" +
	"assignee:\n" +
	"labels:\n" +
	"dueDate:\n" +
	"priority:\n" +
	"parent: 1\n" +
	"blocks: 1\n" +
	"startedAt:\n" +
	"completedAt:\n" +
	"canceledAt:\n" +
	"createdAt: 2026-09-25T09:00:00.000Z\n" +
	"updatedAt: 2026-09-25T09:00:00.000Z\n" +
	"session: session-1\n" +
	"worktree: /work/feature\n" +
	"branch: feat/add-thing\n" +
	"---\n" +
	"\n" +
	"\n"

const specOwnerIssue = "" +
	"---\n" +
	"id: 3\n" +
	"title: owner\n" +
	"status: todo\n" +
	"assignee:\n" +
	"labels:\n" +
	"dueDate:\n" +
	"priority:\n" +
	"parent:\n" +
	"blocks: 4\n" +
	"startedAt:\n" +
	"completedAt:\n" +
	"canceledAt:\n" +
	"createdAt: 2026-09-25T09:00:00.000Z\n" +
	"updatedAt: 2026-09-25T12:00:00.000Z\n" +
	"session:\n" +
	"worktree:\n" +
	"branch:\n" +
	"---\n" +
	"\n" +
	"\n"

func issueSpecDoneMemory() Issue {
	return Issue{
		ID:          "1",
		Title:       `本番: "称号" #1`,
		Status:      "done",
		Assignee:    issueStringPointer("Spec Author"),
		Labels:      []string{"ui", "本番"},
		DueDate:     issueStringPointer("2026-10-01"),
		Priority:    issueStringPointer("high"),
		Blocks:      []string{},
		BlockedBy:   []string{},
		Children:    []string{},
		StartedAt:   issueStringPointer("2026-09-25T09:00:00.000Z"),
		CompletedAt: issueStringPointer("2026-09-25T10:00:00.000Z"),
		CreatedAt:   "2026-09-25T09:00:00.000Z",
		UpdatedAt:   "2026-09-25T10:00:00.000Z",
		Session:     issueStringPointer("session-1"),
		Worktree:    issueStringPointer("/work/feature"),
		Branch:      issueStringPointer("feat/add-thing"),
		Body:        "1 行目\n\n2 行目\n",
	}
}

func issueSpecChildMemory() Issue {
	return Issue{
		ID:        "2",
		Title:     "child",
		Status:    "todo",
		Labels:    []string{},
		Parent:    issueStringPointer("1"),
		Blocks:    []string{"1"},
		BlockedBy: []string{},
		Children:  []string{},
		CreatedAt: "2026-09-25T09:00:00.000Z",
		UpdatedAt: "2026-09-25T09:00:00.000Z",
		Session:   issueStringPointer("session-1"),
		Worktree:  issueStringPointer("/work/feature"),
		Branch:    issueStringPointer("feat/add-thing"),
	}
}

func bareIssue(id string) Issue {
	return Issue{
		ID:        id,
		Title:     "issue " + id,
		Status:    "todo",
		Labels:    []string{},
		Blocks:    []string{},
		BlockedBy: []string{},
		Children:  []string{},
		CreatedAt: "2026-09-01T00:00:00.000Z",
		UpdatedAt: "2026-09-01T00:00:00.000Z",
	}
}

func issueWithPriority(id string, priority string) Issue {
	issue := bareIssue(id)
	if priority != "" {
		issue.Priority = issueStringPointer(priority)
	}
	return issue
}

func issueWithDue(id string, dueDate string, priority string) Issue {
	issue := issueWithPriority(id, priority)
	if dueDate != "" {
		issue.DueDate = issueStringPointer(dueDate)
	}
	return issue
}

func issueIds(issues []Issue) string {
	return issueJoinIDs(issueIDs(issues))
}

func issueIDs(issues []Issue) []string {
	result := make([]string, 0, len(issues))
	for _, issue := range issues {
		result = append(result, issue.ID)
	}
	return result
}

func issueJoinIDs(values []string) string {
	return strings.Join(values, ",")
}

func issueFilterCompleted(issues []Issue, visibility string, now time.Time) []Issue {
	matched := []Issue{}
	for _, issue := range issues {
		if MatchesCompletedVisibility(issue, visibility, now) {
			matched = append(matched, issue)
		}
	}
	return matched
}

func filterIssues(issues []Issue, filter issueResolvedFilter, now time.Time) []Issue {
	matched := []Issue{}
	for _, issue := range issues {
		if issueMatches(issue, filter, now) {
			matched = append(matched, issue)
		}
	}
	return matched
}

func issueMustPatch(t *testing.T, value any) []PatchOp {
	t.Helper()
	ops, err := ParsePatch(value)
	if err != nil {
		t.Fatal(err)
	}
	return ops
}

func issueTestWorkspace(t *testing.T) workspace.Workspace {
	t.Helper()
	root := t.TempDir()
	directory := filepath.Join(root, ".yaru")
	if err := os.MkdirAll(filepath.Join(directory, "issues"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "config.yml"), []byte{}, 0o644); err != nil {
		t.Fatal(err)
	}
	return workspace.Workspace{Root: root, Directory: directory}
}

func issueGitWorkspace(t *testing.T) workspace.Workspace {
	t.Helper()
	root := t.TempDir()
	t.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("TZ", "Asia/Tokyo")
	t.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	t.Chdir(root)
	issueGit(t, "init", "-q", "-b", "develop")
	issueGit(t, "config", "user.name", "Spec Author")
	issueGit(t, "config", "user.email", "spec@example.com")
	directory := filepath.Join(root, ".yaru")
	if err := os.MkdirAll(filepath.Join(directory, "issues"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "config.yml"), []byte{}, 0o644); err != nil {
		t.Fatal(err)
	}
	return workspace.Workspace{Root: root, Directory: directory}
}

func issueGit(t *testing.T, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, output)
	}
}

func issueWriteFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func issueExpectFile(t *testing.T, path string, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != expected {
		t.Fatalf("file %s\nexpected:\n%s\nactual:\n%s", path, expected, content)
	}
}

func issueNoTemporaryFiles(t *testing.T, directory string) {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(directory, "*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary files remained: %v", matches)
	}
}

func issueContainsLine(text string, line string) bool {
	return strings.Contains("\n"+text+"\n", "\n"+line+"\n")
}

func issueNan() float64 {
	return math.NaN()
}
