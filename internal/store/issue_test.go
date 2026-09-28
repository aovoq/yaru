package store

import (
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aovoq/yaru/internal/clock"
	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/workspace"
)

func documentReady() (ready bool) {
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

func gitReady() (ready bool) {
	defer func() {
		if recover() != nil {
			ready = false
		}
	}()
	if !documentReady() {
		return false
	}
	workingDirectory, err := workspace.WorkingDirectory()
	if err != nil {
		return false
	}
	if workspace.GitName(workingDirectory) == "" {
		return false
	}
	return true
}

// 土台 (document・clock・workspace) は中身が panic のままなので、ファイルのバイト列を確かめるテストはそこが入るまで飛ばす。
// 飛ばしたテストは docs/spec/yaru-format.md の例と、一時ディレクトリで動かした TS 版の結果を期待値にしている。
func skipWithoutDocument(t *testing.T) {
	t.Helper()
	if !documentReady() {
		t.Skip("document and clock still panic")
	}
}

func skipWithoutGitName(t *testing.T) {
	t.Helper()
	if !gitReady() {
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
		got, err := resolveDueDate(Present(value))
		if err != nil || got.Value == nil || *got.Value != value {
			t.Fatalf("expected %s to be accepted, err %v got %v", value, err, got.Value)
		}
	}
	rejected := []string{"0001-01-01", "0099-12-31", "0100-02-29", "1900-02-29", "2026-02-30", "2026-08-20T00:00:00Z", "08-20"}
	for _, value := range rejected {
		_, err := resolveDueDate(Present(value))
		if err == nil || err.Error() != "invalid dueDate: expected YYYY-MM-DD, actual "+value {
			t.Fatalf("value %q: %v", value, err)
		}
	}
	spaced := " 2026-02-30"
	_, err := resolveDueDate(Present(spaced))
	if err == nil || err.Error() != "invalid dueDate: expected YYYY-MM-DD, actual "+spaced {
		t.Fatalf("spaced: %v", err)
	}
	cleared, err := resolveDueDate(Present("none"))
	if err != nil || cleared.Value != nil {
		t.Fatal("none was not cleared")
	}
	if _, err := resolveDueDate(Optional[string]{}); err != nil {
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
		_, err := resolveStatus(value)
		if err == nil || err.Error() != "invalid status: expected backlog, todo, in_progress, done, or canceled, actual "+value {
			t.Fatalf("status %q: %v", value, err)
		}
	}
	status, err := resolveStatus(" todo ")
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
	_, err = ResolveLimit(nan())
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
	if ids(first.Issues) != "3,2" || !first.HasNextPage || first.Cursor == nil || *first.Cursor != "2" {
		t.Fatalf("first page: %+v", first)
	}
	second, err := PageIssues(issues, PageOptions{Limit: 2, Cursor: first.Cursor})
	if err != nil {
		t.Fatal(err)
	}
	if ids(second.Issues) != "1" || second.HasNextPage || second.Cursor != nil {
		t.Fatalf("second page: %+v", second)
	}
	_, err = PageIssues(issues, PageOptions{Cursor: stringPointer("99")})
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
	if ids(issues) != "9,2,10,1" {
		t.Fatalf("list order: %s", ids(issues))
	}
}

func TestSortIssues(t *testing.T) {
	issues := []Issue{
		withPriority("9", "low"),
		withPriority("10", ""),
		withPriority("2", "urgent"),
		withPriority("11", "low"),
		withPriority("3", "high"),
		withPriority("4", "medium"),
		withPriority("12", ""),
	}
	sorted := SortIssues(issues, SortPriority)
	if ids(sorted) != "2,3,4,11,9,12,10" {
		t.Fatalf("priority: %s", ids(sorted))
	}
	if issues[0].ID != "9" {
		t.Fatal("sort mutated the input")
	}
	nonNumeric := SortIssues([]Issue{bareIssue("alpha"), bareIssue("2"), bareIssue("beta")}, SortPriority)
	if ids(nonNumeric) != "beta,alpha,2" {
		t.Fatalf("non numeric: %s", ids(nonNumeric))
	}
	timed := []Issue{bareIssue("9"), bareIssue("10"), bareIssue("1")}
	timed[0].UpdatedAt = "2026-09-20T00:00:00.000Z"
	timed[0].CreatedAt = "2026-09-01T00:00:00.000Z"
	timed[1].UpdatedAt = "2026-09-20T00:00:00.000Z"
	timed[1].CreatedAt = "2026-09-02T00:00:00.000Z"
	timed[2].UpdatedAt = "2026-09-21T00:00:00.000Z"
	timed[2].CreatedAt = "2026-09-02T00:00:00.000Z"
	if ids(SortIssues(timed, SortUpdated)) != "1,10,9" {
		t.Fatalf("updated: %s", ids(SortIssues(timed, SortUpdated)))
	}
	if ids(SortIssues(timed, SortCreated)) != "10,1,9" {
		t.Fatalf("created: %s", ids(SortIssues(timed, SortCreated)))
	}
	due := []Issue{
		withDue("1", "", "urgent"),
		withDue("2", "2026-10-02", ""),
		withDue("3", "2026-10-01", "low"),
		withDue("4", "2026-10-01", "high"),
	}
	if ids(SortIssues(due, SortDue)) != "4,3,2,1" {
		t.Fatalf("due: %s", ids(SortIssues(due, SortDue)))
	}
}

func TestParseDisplayChoices(t *testing.T) {
	if got, err := ParseIssueSort(nil); err != nil || got != SortPriority {
		t.Fatalf("nil sort: %s %v", got, err)
	}
	if got, err := ParseIssueSort(stringPointer("")); err != nil || got != SortPriority {
		t.Fatalf("empty sort: %s %v", got, err)
	}
	if got, err := ParseIssueSort(stringPointer("due")); err != nil || got != SortDue {
		t.Fatalf("due: %s %v", got, err)
	}
	if got, err := ParseIssueGroup(nil); err != nil || got != GroupStatus {
		t.Fatal(err)
	}
	if got, err := ParseIssueGroup(stringPointer("none")); err != nil || got != GroupNone {
		t.Fatal(err)
	}
	if got, err := ParseCompletedVisibility(nil); err != nil || got != CompletedRecent {
		t.Fatal(err)
	}
	if got, err := ParseCompletedVisibility(stringPointer("all")); err != nil || got != CompletedAll {
		t.Fatal(err)
	}
}

func TestParseDisplayChoicesRejectUnknown(t *testing.T) {
	skipWithoutDocument(t)
	_, err := ParseIssueSort(stringPointer("title"))
	if err == nil || err.Error() != `invalid sort: expected priority, updated, created, or due, actual "title"` {
		t.Fatal(err)
	}
	_, err = ParseIssueGroup(stringPointer("assignee"))
	if err == nil || err.Error() != `invalid group: expected status, priority, label, or none, actual "assignee"` {
		t.Fatal(err)
	}
	_, err = ParseCompletedVisibility(stringPointer("old"))
	if err == nil || err.Error() != `invalid completed: expected hide, recent, or all, actual "old"` {
		t.Fatal(err)
	}
}

func TestCompletedVisibility(t *testing.T) {
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	day := 24 * time.Hour
	recentlyDone := bareIssue("1")
	recentlyDone.Status = "done"
	recentlyDone.CompletedAt = stringPointer(now.Add(-(time.Duration(CompletedRecentDays)*day - time.Millisecond)).UTC().Format(time.RFC3339Nano))
	longDone := bareIssue("2")
	longDone.Status = "done"
	longDone.CompletedAt = stringPointer(now.Add(-(time.Duration(CompletedRecentDays)*day + time.Millisecond)).UTC().Format(time.RFC3339Nano))
	exact := bareIssue("6")
	exact.Status = "done"
	exact.CompletedAt = stringPointer(now.Add(-time.Duration(CompletedRecentDays) * day).UTC().Format(time.RFC3339Nano))
	recentlyCanceled := bareIssue("3")
	recentlyCanceled.Status = "canceled"
	recentlyCanceled.CanceledAt = stringPointer(now.Add(-day).UTC().Format(time.RFC3339Nano))
	handEdited := bareIssue("4")
	handEdited.Status = "done"
	handEdited.UpdatedAt = now.Add(-30 * day).UTC().Format(time.RFC3339Nano)
	open := bareIssue("5")
	open.UpdatedAt = "2020-01-01T00:00:00.000Z"
	rows := []Issue{recentlyDone, longDone, recentlyCanceled, handEdited, open}
	if ids(filterCompleted(rows, CompletedRecent, now)) != "1,3,5" {
		t.Fatalf("recent: %s", ids(filterCompleted(rows, CompletedRecent, now)))
	}
	if ids(filterCompleted(rows, CompletedHide, now)) != "5" {
		t.Fatalf("hide: %s", ids(filterCompleted(rows, CompletedHide, now)))
	}
	if ids(filterCompleted(append(rows, exact), CompletedAll, now)) != "1,2,3,4,5,6" {
		t.Fatal(ids(filterCompleted(append(rows, exact), CompletedAll, now)))
	}
	if MatchesCompletedVisibility(exact, CompletedRecent, now) {
		t.Fatal("exactly 7 days is still recent")
	}
}

func TestDueDateDisplay(t *testing.T) {
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.Local)
	if !IsIssueOverdue(stringPointer("2026-09-25"), "todo", now) {
		t.Fatal("past open issue was not overdue")
	}
	if IsIssueOverdue(stringPointer("2026-09-26"), "in_progress", now) {
		t.Fatal("today was overdue")
	}
	if IsIssueOverdue(stringPointer("2026-01-01"), "done", now) || IsIssueOverdue(stringPointer("2026-01-01"), "canceled", now) {
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
	skipWithoutDocument(t)
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
	all[1].Parent = stringPointer("1")
	parent, err := resolveParent("3", Present("1"), all)
	if err != nil || parent == nil || *parent != "1" {
		t.Fatal(err)
	}
	cleared, err := resolveParent("2", Present("none"), all)
	if err != nil || cleared != nil {
		t.Fatal("none parent was not cleared")
	}
	_, err = resolveParent("1", Present("1"), all)
	if err == nil || err.Error() != "invalid parent: an issue cannot be its own parent, actual 1" {
		t.Fatal(err)
	}
	_, err = resolveParent("4", Present("9"), append(all, bareIssue("4")))
	if err == nil || err.Error() != "invalid parent: issue not found: 9" {
		t.Fatal(err)
	}
	_, err = resolveParent("1", Present("2"), all)
	if err == nil || err.Error() != "invalid parent: cycle: 2 is a descendant of 1" {
		t.Fatal(err)
	}

	relations, err := resolveBlocks("1", nil, SaveInput{AddBlocks: Present([]string{"2"})}, all)
	if err != nil || joinIDs(relations.blocks) != "2" {
		t.Fatal(err, relations.blocks)
	}
	relations, err = resolveBlocks("1", []string{"2", "3"}, SaveInput{Blocks: Present([]string{"3", "3"})}, all)
	if err != nil || joinIDs(relations.blocks) != "3" {
		t.Fatal(relations.blocks, err)
	}
	_, err = resolveBlocks("1", nil, SaveInput{AddBlocks: Present([]string{"1"})}, all)
	if err == nil || err.Error() != "invalid block: an issue cannot block itself, actual 1" {
		t.Fatal(err)
	}
	_, err = resolveBlocks("1", nil, SaveInput{AddBlocks: Present([]string{"9"})}, all)
	if err == nil || err.Error() != "invalid block: issue not found: 9" {
		t.Fatal(err)
	}
	blocking := []Issue{bareIssue("1"), bareIssue("2")}
	blocking[0].Blocks = []string{"2"}
	_, err = resolveBlocks("2", nil, SaveInput{AddBlocks: Present([]string{"1"})}, blocking)
	if err == nil || err.Error() != "invalid block: cycle: 2 already blocked by 1" {
		t.Fatal(err)
	}
	_, err = resolveBlocks("1", nil, SaveInput{Blocks: Present([]string{"2"}), AddBlocks: Present([]string{"3"})}, all)
	if err == nil || err.Error() != "cannot pass blocks with addBlocks, removeBlocks, addBlockedBy, or removeBlockedBy" {
		t.Fatal(err)
	}
	// 辺が既にあっても addBlockedBy は相手を所有者に入れる。updatedAt を進めるのは書き込み側 (src/store.ts:571-588)。
	relations, err = resolveBlocks("4", nil, SaveInput{AddBlockedBy: Present([]string{"3", "3"})}, []Issue{bareIssue("3"), bareIssue("4")})
	if err != nil || len(relations.owners) != 1 || relations.owners[0].id != "3" || joinIDs(relations.owners[0].blocks) != "4" {
		t.Fatalf("%+v %v", relations, err)
	}
	already := []Issue{bareIssue("3"), bareIssue("4")}
	already[0].Blocks = []string{"4"}
	relations, err = resolveBlocks("4", nil, SaveInput{AddBlockedBy: Present([]string{"3"})}, already)
	if err != nil || len(relations.owners) != 1 || joinIDs(relations.owners[0].blocks) != "4" {
		t.Fatalf("repeat: %+v %v", relations, err)
	}
}

func TestStatusTimestamps(t *testing.T) {
	created := statusTimestamps(nil, "todo", "2026-09-25T09:00:00.000Z")
	if created.startedAt != nil || created.completedAt != nil || created.canceledAt != nil {
		t.Fatal("todo created with timestamps")
	}
	done := statusTimestamps(nil, "done", "2026-09-25T09:00:00.000Z")
	if done.startedAt != nil || done.completedAt == nil || *done.completedAt != "2026-09-25T09:00:00.000Z" {
		t.Fatal("create as done")
	}
	current := bareIssue("1")
	current.Status = "todo"
	started := statusTimestamps(&current, "in_progress", "T1")
	if started.startedAt == nil || *started.startedAt != "T1" {
		t.Fatal("startedAt")
	}
	current.Status = "in_progress"
	current.StartedAt = stringPointer("T1")
	finished := statusTimestamps(&current, "done", "T2")
	if finished.startedAt == nil || *finished.startedAt != "T1" || finished.completedAt == nil || *finished.completedAt != "T2" {
		t.Fatal("done keeps startedAt")
	}
	current.Status = "done"
	current.CompletedAt = stringPointer("T2")
	reopened := statusTimestamps(&current, "todo", "T3")
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
	after.Priority = stringPointer("high")
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
	got, err := applyPatch("alpha\nbeta\ngamma", ops)
	if err != nil || got != "alpha\nBETA\ngamma" {
		t.Fatal(got, err)
	}
	ops, err = ParsePatch([]any{
		map[string]any{"op": "replace", "old_string": "foo", "new_string": "baz", "replace_all": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err = applyPatch("foo bar foo", ops)
	if err != nil || got != "baz bar baz" {
		t.Fatal(got, err)
	}
	ops, err = ParsePatch([]any{map[string]any{"op": "replace", "old_string": "foo", "new_string": "baz"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = applyPatch("foo bar foo", ops)
	if err == nil || err.Error() != "patch replace: old_string must match the current body exactly once, expected 1 match, actual 2" {
		t.Fatal(err)
	}
	_, err = applyPatch("only", ops)
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
	got, err = applyPatch("middle", ops)
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
	got, err = applyPatch("core", ops)
	if err != nil || got != "start\ncore\nend" {
		t.Fatal(got, err)
	}
	ops, err = ParsePatch([]any{
		map[string]any{"op": "replace_range", "from": "hello ", "to": " foo", "new_string": "hi"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err = applyPatch("hello WORLD foo", ops)
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
	_, err = applyPatch("alpha\nbeta", mustPatch(t, []any{
		map[string]any{"op": "replace", "old_string": "alpha", "new_string": "ALPHA"},
		map[string]any{"op": "replace", "old_string": "missing", "new_string": "x"},
	}))
	if err == nil || err.Error() != "patch replace: old_string must match the current body exactly once, expected 1 match, actual 0" {
		t.Fatal(err)
	}
}

func TestParsePatchQuotesStrings(t *testing.T) {
	skipWithoutDocument(t)
	_, err := ParsePatch([]any{map[string]any{"op": "replace", "old_string": "", "new_string": "a"}})
	if err == nil || err.Error() != `invalid patch replace: old_string must be a non-empty string, actual ""` {
		t.Fatal(err)
	}
	_, err = ParsePatch([]any{"x"})
	if err == nil || err.Error() != `invalid patch: expected an operation object, actual "x"` {
		t.Fatal(err)
	}
	_, err = ParsePatch(absent{})
	if err == nil || err.Error() != "invalid patch: expected a JSON array of operations, actual undefined" {
		t.Fatal(err)
	}
}

func TestNextIssueID(t *testing.T) {
	space := testWorkspace(t)
	first, err := nextIssueID(space)
	if err != nil || first != "1" {
		t.Fatal(first, err)
	}
	writeFile(t, filepath.Join(space.Directory, "issues", "5.md"), "x")
	writeFile(t, filepath.Join(space.Directory, "issues", "01.md"), "x")
	writeFile(t, filepath.Join(space.Directory, "issues", "notes.md"), "x")
	next, err := nextIssueID(space)
	if err != nil || next != "6" {
		t.Fatalf("next id: %s %v", next, err)
	}
}

func TestWriteCreateAndReplace(t *testing.T) {
	space := testWorkspace(t)
	path := filepath.Join(space.Directory, "issues", "1.md")
	if err := writeCreate(path, "one"); err != nil {
		t.Fatal(err)
	}
	if err := writeCreate(path, "two"); err == nil || !isExist(err) {
		t.Fatal(err)
	}
	if err := writeReplace(path, "replaced"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "replaced" {
		t.Fatal(string(content), err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("temp file remained")
	}
}

func TestIssueEventsReader(t *testing.T) {
	space := testWorkspace(t)
	_, err := IssueEvents(space, "9")
	if err == nil || err.Error() != "issue not found: 9" {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(space.Directory, "issues", "1.md"), "x")
	events, err := IssueEvents(space, "1")
	if err != nil || len(events) != 0 {
		t.Fatal(events, err)
	}
	payload := "{\"field\":\"status\",\"from\":\"in_progress\",\"to\":\"done\",\"by\":\"Spec Author\",\"session\":\"session-1\",\"at\":\"2026-09-25T10:00:00.000Z\"}\n{broken\n\n{\"field\":\"nope\"}\n{\"field\":\"labels\",\"from\":[],\"to\":[\"ui\",\"本番\"],\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T09:00:00.000Z\",\"extra\":true}\n"
	writeFile(t, filepath.Join(space.Directory, "events", "1.jsonl"), payload)
	events, err = IssueEvents(space, "1")
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
	space := testWorkspace(t)
	if err := AppendIssueEvents(space, "1", nil, IssueEventContext{By: "Spec Author", At: "2026-09-25T09:00:00.000Z"}); err != nil {
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
	late.DueDate = stringPointer("2026-09-27")
	today := bareIssue("2")
	today.DueDate = stringPointer("2026-09-28")
	shipped := bareIssue("3")
	shipped.Status = "done"
	shipped.DueDate = stringPointer("2026-09-27")
	child := bareIssue("4")
	child.Parent = stringPointer("1")
	child.Assignee = stringPointer("Ada")
	child.Labels = []string{"cli"}
	child.Body = "search me"
	overdue, err := resolveListFilter(Filter{Due: Present("overdue")})
	if err != nil {
		t.Fatal(err)
	}
	matched := filterIssues([]Issue{late, today, shipped, child}, overdue, now)
	if ids(matched) != "1" {
		t.Fatalf("overdue: %s", ids(matched))
	}
	parent, err := resolveListFilter(Filter{Parent: Present("none")})
	if err != nil {
		t.Fatal(err)
	}
	if ids(filterIssues([]Issue{late, child}, parent, now)) != "1" {
		t.Fatal("parent none")
	}
	unassigned, err := resolveListFilter(Filter{Assignee: Present("none")})
	if err != nil {
		t.Fatal(err)
	}
	if ids(filterIssues([]Issue{late, child}, unassigned, now)) != "1" {
		t.Fatal("assignee none")
	}
	query, err := resolveListFilter(Filter{Query: Present("SEARCH")})
	if err != nil {
		t.Fatal(err)
	}
	if ids(filterIssues([]Issue{late, child}, query, now)) != "4" {
		t.Fatal("query")
	}
	label, err := resolveListFilter(Filter{Label: Present("cli")})
	if err != nil {
		t.Fatal(err)
	}
	if ids(filterIssues([]Issue{late, child}, label, now)) != "4" {
		t.Fatal("label")
	}
	_, err = resolveListFilter(Filter{Status: Present("nope")})
	if err == nil || err.Error() != "invalid status: expected backlog, todo, in_progress, done, or canceled, actual nope" {
		t.Fatal(err)
	}
}

func TestReadStaleAfter(t *testing.T) {
	space := testWorkspace(t)
	got, err := ReadStaleAfter(space)
	if err != nil || got != DefaultStaleAfterMilliseconds {
		t.Fatal(got, err)
	}
	writeFile(t, filepath.Join(space.Directory, "config.yml"), "notify: echo x\nstaleAfter: 90m\n")
	got, err = ReadStaleAfter(space)
	if err != nil || got != 90*60_000 {
		t.Fatal(got, err)
	}
	writeFile(t, filepath.Join(space.Directory, "config.yml"), "staleAfter:\nnotify: x\n")
	got, err = ReadStaleAfter(space)
	if err != nil || got != DefaultStaleAfterMilliseconds {
		t.Fatal("empty staleAfter should fall through to the default", got, err)
	}
}

func TestLoadRawIssuesSkipsCorruptFiles(t *testing.T) {
	space := testWorkspace(t)
	writeFile(t, filepath.Join(space.Directory, "issues", "1.md"), specDoneIssue)
	writeFile(t, filepath.Join(space.Directory, "issues", "2.md"), "not an issue")
	writeFile(t, filepath.Join(space.Directory, "issues", "3.md"), "---\nid: 3\ntitle: bad\nstatus: nope\nassignee:\nlabels:\n---\n\nx\n")
	issues, err := loadRawIssues(space)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 || issues[0].ID != "1" {
		t.Fatalf("kept %s", ids(issues))
	}
	_, err = readIssue(filepath.Join(space.Directory, "issues", "2.md"), "2")
	if err == nil || err.Error() != "invalid issue file" {
		t.Fatal(err)
	}
	_, err = readIssue(filepath.Join(space.Directory, "issues", "3.md"), "3")
	if err == nil || err.Error() != "invalid status: expected backlog, todo, in_progress, done, or canceled, actual nope" {
		t.Fatal(err)
	}
}

func TestFormatAndParseIssueMatchTheSpec(t *testing.T) {
	formatted := formatIssue(specDoneMemory())
	if formatted != specDoneIssue {
		t.Fatalf("format\nexpected:\n%s\nactual:\n%s", specDoneIssue, formatted)
	}
	parsed, err := parseIssue(specDoneIssue)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Title != `本番: "称号" #1` || parsed.Status != "done" || parsed.Assignee == nil || *parsed.Assignee != "Spec Author" {
		t.Fatalf("parsed header: %+v", parsed)
	}
	if joinIDs(parsed.Labels) != "ui,本番" || parsed.DueDate == nil || *parsed.DueDate != "2026-10-01" || parsed.Priority == nil || *parsed.Priority != "high" {
		t.Fatalf("parsed fields: %+v", parsed)
	}
	if parsed.Body != "1 行目\n\n2 行目\n" || parsed.Parent != nil || len(parsed.Blocks) != 0 {
		t.Fatalf("parsed body: %+v", parsed)
	}
	if parsed.Session == nil || *parsed.Session != "session-1" || parsed.StartedAt == nil || parsed.CompletedAt == nil {
		t.Fatalf("parsed times: %+v", parsed)
	}
	child := formatIssue(specChildMemory())
	if child != specChildIssue {
		t.Fatalf("child\nexpected:\n%s\nactual:\n%s", specChildIssue, child)
	}
	newline := specDoneMemory()
	newline.Title = "b\nc"
	if !containsLine(formatIssue(newline), "title: b c") {
		t.Fatal(formatIssue(newline))
	}
}

func TestAppendIssueEventBytes(t *testing.T) {
	space := testWorkspace(t)
	err := AppendIssueEvents(space, "1", []IssueChange{{
		Field: "status",
		From:  "in_progress",
		To:    "done",
	}}, IssueEventContext{By: "Spec Author", Session: stringPointer("session-1"), At: "2026-09-25T10:00:00.000Z"})
	if err != nil {
		t.Fatal(err)
	}
	expectFile(t, filepath.Join(space.Directory, "events", "1.jsonl"), "{\"field\":\"status\",\"from\":\"in_progress\",\"to\":\"done\",\"by\":\"Spec Author\",\"session\":\"session-1\",\"at\":\"2026-09-25T10:00:00.000Z\"}\n")
	err = AppendIssueEvents(space, "2", []IssueChange{{
		Field: "labels",
		From:  []string{},
		To:    []string{"ui", "本番"},
	}}, IssueEventContext{By: "Spec Author", At: "2026-09-25T09:00:00.000Z"})
	if err != nil {
		t.Fatal(err)
	}
	expectFile(t, filepath.Join(space.Directory, "events", "2.jsonl"), "{\"field\":\"labels\",\"from\":[],\"to\":[\"ui\",\"本番\"],\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T09:00:00.000Z\"}\n")
	err = AppendIssueEvents(space, "3", []IssueChange{{
		Field: "title",
		From:  "a",
		To:    "b\nc",
	}}, IssueEventContext{By: "Spec Author", At: "2026-09-25T09:00:00.000Z"})
	if err != nil {
		t.Fatal(err)
	}
	expectFile(t, filepath.Join(space.Directory, "events", "3.jsonl"), "{\"field\":\"title\",\"from\":\"a\",\"to\":\"b\\nc\",\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T09:00:00.000Z\"}\n")
	err = AppendIssueEvents(space, "3", []IssueChange{{
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
	space := testWorkspace(t)
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.Local)
	parent := specDoneMemory()
	parent.Status = "todo"
	parent.StartedAt = nil
	parent.CompletedAt = nil
	parent.DueDate = stringPointer("2026-09-01")
	parent.UpdatedAt = "2026-09-25T10:00:00.000Z"
	child := specChildMemory()
	child.Status = "in_progress"
	child.StartedAt = stringPointer("2026-09-20T00:00:00.000Z")
	child.UpdatedAt = "2026-09-20T00:00:00.000Z"
	writeFile(t, filepath.Join(space.Directory, "issues", "1.md"), formatIssue(parent))
	writeFile(t, filepath.Join(space.Directory, "issues", "2.md"), formatIssue(child))
	writeFile(t, filepath.Join(space.Directory, "issues", "9.md"), "not an issue")
	listed, err := ListIssues(space, Filter{}, &now)
	if err != nil {
		t.Fatal(err)
	}
	if ids(listed) != "1,2" {
		t.Fatalf("list: %s", ids(listed))
	}
	if !listed[1].Stale || listed[0].Stale {
		t.Fatalf("stale: %+v %+v", listed[0].Stale, listed[1].Stale)
	}
	if joinIDs(listed[0].Children) != "2" || joinIDs(listed[0].BlockedBy) != "2" {
		t.Fatalf("derived: %+v", listed[0])
	}
	overdue, err := ListIssues(space, Filter{Due: Present("overdue")}, &now)
	if err != nil || ids(overdue) != "1" {
		t.Fatalf("overdue: %s %v", ids(overdue), err)
	}
	children, err := ListIssues(space, Filter{Parent: Present("1")}, &now)
	if err != nil || ids(children) != "2" {
		t.Fatal(ids(children), err)
	}
	got, err := GetIssue(space, "2", &now)
	if err != nil || got.Parent == nil || *got.Parent != "1" || !got.Stale || joinIDs(got.Blocks) != "1" {
		t.Fatalf("%+v %v", got, err)
	}
	page, err := PageIssues(listed, PageOptions{Limit: 1})
	if err != nil || ids(page.Issues) != "1" || !page.HasNextPage || page.Cursor == nil || *page.Cursor != "1" {
		t.Fatalf("page: %+v %v", page, err)
	}
}

func TestSaveIssueBytes(t *testing.T) {
	skipWithoutGitName(t)
	space := gitWorkspace(t)
	provenance := &Provenance{
		Session:  stringPointer("session-1"),
		Worktree: stringPointer("/work/feature"),
		Branch:   stringPointer("feat/add-thing"),
	}
	createdAt := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	doneAt := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
	_, err := SaveIssue(space, SaveInput{
		Title:    Present(`本番: "称号" #1`),
		Status:   Present("in_progress"),
		Assignee: Present("Spec Author"),
		Labels:   Present([]string{"ui", "本番"}),
		DueDate:  Present("2026-10-01"),
		Priority: Present("high"),
		Body:     Present("1 行目\n\n2 行目\n"),
	}, SaveOptions{Now: &createdAt, Provenance: provenance})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(space.Directory, "events")); !os.IsNotExist(err) {
		t.Fatal("create wrote an event")
	}
	done, err := SaveIssue(space, SaveInput{ID: "1", Status: Present("done")}, SaveOptions{Now: &doneAt, Provenance: provenance})
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "done" || done.Body != "1 行目\n\n2 行目\n" {
		t.Fatalf("%+v", done)
	}
	expectFile(t, filepath.Join(space.Directory, "issues", "1.md"), specDoneIssue)
	expectFile(t, filepath.Join(space.Directory, "events", "1.jsonl"), "{\"field\":\"status\",\"from\":\"in_progress\",\"to\":\"done\",\"by\":\"Spec Author\",\"session\":\"session-1\",\"at\":\"2026-09-25T10:00:00.000Z\"}\n")
}

func TestSaveIssueChildAndBlockedBy(t *testing.T) {
	skipWithoutGitName(t)
	space := gitWorkspace(t)
	provenance := &Provenance{
		Session:  stringPointer("session-1"),
		Worktree: stringPointer("/work/feature"),
		Branch:   stringPointer("feat/add-thing"),
	}
	createdAt := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	updatedAt := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	if _, err := SaveIssue(space, SaveInput{Title: Present("parent")}, SaveOptions{Now: &createdAt, Provenance: provenance}); err != nil {
		t.Fatal(err)
	}
	child, err := SaveIssue(space, SaveInput{Title: Present("child"), Parent: Present("1"), AddBlocks: Present([]string{"1"})}, SaveOptions{Now: &createdAt, Provenance: provenance})
	if err != nil {
		t.Fatal(err)
	}
	if child.Parent == nil || *child.Parent != "1" || joinIDs(child.Blocks) != "1" {
		t.Fatalf("child: %+v", child)
	}
	expectFile(t, filepath.Join(space.Directory, "issues", "2.md"), specChildIssue)
	parent, err := GetIssue(space, "1", &createdAt)
	if err != nil || joinIDs(parent.Children) != "2" || joinIDs(parent.BlockedBy) != "2" {
		t.Fatalf("%+v %v", parent, err)
	}
	ownerAt := createdAt
	if _, err := SaveIssue(space, SaveInput{Title: Present("owner")}, SaveOptions{Now: &ownerAt}); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveIssue(space, SaveInput{Title: Present("blocked")}, SaveOptions{Now: &ownerAt}); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveIssue(space, SaveInput{ID: "4", AddBlockedBy: Present([]string{"3"})}, SaveOptions{Now: &updatedAt}); err != nil {
		t.Fatal(err)
	}
	expectFile(t, filepath.Join(space.Directory, "issues", "3.md"), specOwnerIssue)
	expectFile(t, filepath.Join(space.Directory, "events", "3.jsonl"), "{\"field\":\"blocks\",\"from\":[],\"to\":[\"4\"],\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T12:00:00.000Z\"}\n")
	later := time.Date(2026, 9, 25, 13, 0, 0, 0, time.UTC)
	if _, err := SaveIssue(space, SaveInput{ID: "4", AddBlockedBy: Present([]string{"3"})}, SaveOptions{Now: &later}); err != nil {
		t.Fatal(err)
	}
	owner, err := GetIssue(space, "3", &later)
	if err != nil || owner.UpdatedAt != "2026-09-25T13:00:00.000Z" || joinIDs(owner.Blocks) != "4" {
		t.Fatalf("repeat blockedBy: %+v %v", owner, err)
	}
	expectFile(t, filepath.Join(space.Directory, "events", "3.jsonl"), "{\"field\":\"blocks\",\"from\":[],\"to\":[\"4\"],\"by\":\"Spec Author\",\"session\":null,\"at\":\"2026-09-25T12:00:00.000Z\"}\n")
}

func TestSaveIssueTitleNewlineAndLabels(t *testing.T) {
	skipWithoutGitName(t)
	space := gitWorkspace(t)
	now := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	if _, err := SaveIssue(space, SaveInput{Title: Present("a")}, SaveOptions{Now: &now}); err != nil {
		t.Fatal(err)
	}
	updated, err := SaveIssue(space, SaveInput{ID: "1", Title: Present("b\nc")}, SaveOptions{Now: &now})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "b c" {
		t.Fatalf("read title: %q", updated.Title)
	}
	events, err := IssueEvents(space, "1")
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
	saved, err := SaveIssue(space, SaveInput{Title: Present("labels"), Labels: Present([]string{" a ", "a, b", "c"})}, SaveOptions{Now: &now})
	if err != nil {
		t.Fatal(err)
	}
	if joinIDs(saved.Labels) != "a,a,b,c" {
		t.Fatalf("labels read: %v", saved.Labels)
	}
	text, err := os.ReadFile(filepath.Join(space.Directory, "issues", saved.ID+".md"))
	if err != nil {
		t.Fatal(err)
	}
	if !containsLine(string(text), "labels:  a , a, b, c") {
		t.Fatalf("label line missing:\n%s", text)
	}
}

func TestSaveIssueErrorsLeaveFilesUntouched(t *testing.T) {
	skipWithoutGitName(t)
	space := gitWorkspace(t)
	now := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	_, err := SaveIssue(space, SaveInput{DueDate: Present("2026-02-30")}, SaveOptions{Now: &now})
	if err == nil || err.Error() != "invalid dueDate: expected YYYY-MM-DD, actual 2026-02-30" {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(filepath.Join(space.Directory, "issues", "1.md")); !os.IsNotExist(statErr) {
		t.Fatal("invalid due date created a file")
	}
	_, err = SaveIssue(space, SaveInput{}, SaveOptions{Now: &now})
	if err == nil || err.Error() != "title is required when creating an issue" {
		t.Fatal(err)
	}
	_, err = SaveIssue(space, SaveInput{Title: Present("   ")}, SaveOptions{Now: &now})
	if err == nil || err.Error() != "title is required when creating an issue" {
		t.Fatal(err)
	}
	if _, err := SaveIssue(space, SaveInput{Title: Present("keep")}, SaveOptions{Now: &now}); err != nil {
		t.Fatal(err)
	}
	_, err = SaveIssue(space, SaveInput{ID: "1", Title: Present("  ")}, SaveOptions{Now: &now})
	if err == nil || err.Error() != `invalid title: expected a non-empty string, actual "  "` {
		t.Fatal(err)
	}
	kept, err := GetIssue(space, "1", &now)
	if err != nil || kept.Title != "keep" {
		t.Fatal(kept.Title, err)
	}
	_, err = SaveIssue(space, SaveInput{ID: "7", Title: Present("explicit")}, SaveOptions{Now: &now})
	if err == nil || err.Error() != "issue not found: 7" {
		t.Fatal(err)
	}
	_, err = SaveIssue(space, SaveInput{ID: "1", Body: Present("new"), PatchSet: true, Patch: []any{map[string]any{"op": "append", "text": "!"}}}, SaveOptions{Now: &now})
	if err == nil || err.Error() != "cannot pass body and patch together" {
		t.Fatal(err)
	}
	_, err = SaveIssue(space, SaveInput{Title: Present("x"), PatchSet: true, Patch: []any{map[string]any{"op": "append", "text": "!"}}}, SaveOptions{Now: &now})
	if err == nil || err.Error() != "patch is only valid when updating an existing issue" {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(space.Directory, "config.yml"), "staleAfter: nope\n")
	before, err := os.ReadDir(filepath.Join(space.Directory, "issues"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = SaveIssue(space, SaveInput{Title: Present("task")}, SaveOptions{Now: &now})
	if err == nil || err.Error() != `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual "nope"` {
		t.Fatal(err)
	}
	after, err := os.ReadDir(filepath.Join(space.Directory, "issues"))
	if err != nil || len(after) != len(before) {
		t.Fatal("broken staleAfter wrote an issue")
	}
}

func TestSaveIssueKeepsProvenanceAndAssigneeMe(t *testing.T) {
	skipWithoutGitName(t)
	space := gitWorkspace(t)
	now := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	provenance := &Provenance{Session: stringPointer("session-1"), Worktree: stringPointer("/work/feature"), Branch: stringPointer("feat/add-thing")}
	created, err := SaveIssue(space, SaveInput{Title: Present("task"), Assignee: Present("me")}, SaveOptions{Now: &now, Provenance: provenance})
	if err != nil {
		t.Fatal(err)
	}
	if created.Assignee == nil || *created.Assignee != "Spec Author" {
		t.Fatalf("assignee: %v", created.Assignee)
	}
	if created.Session == nil || *created.Session != "session-1" || created.Branch == nil || *created.Branch != "feat/add-thing" {
		t.Fatalf("provenance: %+v", created)
	}
	updated, err := SaveIssue(space, SaveInput{ID: "1", Status: Present("done")}, SaveOptions{Now: &now})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Session == nil || *updated.Session != "session-1" || updated.Worktree == nil || *updated.Worktree != "/work/feature" {
		t.Fatalf("provenance was cleared: %+v", updated)
	}
	none, err := SaveIssue(space, SaveInput{Title: Present("none")}, SaveOptions{Now: &now, Provenance: &Provenance{Session: stringPointer("none"), Worktree: stringPointer("none"), Branch: stringPointer("none")}})
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
	if !containsLine(string(text), "session: none") || !containsLine(string(text), "worktree: none") || !containsLine(string(text), "branch: none") {
		t.Fatalf("file cleared none:\n%s", text)
	}
}

func TestListSkipsCorruptAndUsesFilenameID(t *testing.T) {
	skipWithoutGitName(t)
	space := gitWorkspace(t)
	now := time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)
	if _, err := SaveIssue(space, SaveInput{Title: Present("ok")}, SaveOptions{Now: &now}); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(space.Directory, "issues", "9.md"), "not an issue")
	writeFile(t, filepath.Join(space.Directory, "issues", "01.md"), "---\nid: 99\ntitle: padded\nstatus: todo\nassignee:\nlabels:\ncreatedAt: t\nupdatedAt: t\n---\n\nx\n")
	listed, err := ListIssues(space, Filter{}, &now)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, issue := range listed {
		found[issue.ID] = true
	}
	if !found["1"] || !found["01"] || found["9"] {
		t.Fatalf("ids: %s", ids(listed))
	}
	padded, err := GetIssue(space, "01", &now)
	if err != nil || padded.ID != "01" {
		t.Fatal(padded.ID, err)
	}
	_, err = GetIssue(space, "9", &now)
	if err == nil || err.Error() != "invalid issue file" {
		t.Fatal(err)
	}
	next, err := SaveIssue(space, SaveInput{Title: Present("next")}, SaveOptions{Now: &now})
	if err != nil || next.ID != "10" {
		t.Fatalf("next: %+v %v", next, err)
	}
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

func specDoneMemory() Issue {
	return Issue{
		ID:          "1",
		Title:       `本番: "称号" #1`,
		Status:      "done",
		Assignee:    stringPointer("Spec Author"),
		Labels:      []string{"ui", "本番"},
		DueDate:     stringPointer("2026-10-01"),
		Priority:    stringPointer("high"),
		Blocks:      []string{},
		BlockedBy:   []string{},
		Children:    []string{},
		StartedAt:   stringPointer("2026-09-25T09:00:00.000Z"),
		CompletedAt: stringPointer("2026-09-25T10:00:00.000Z"),
		CreatedAt:   "2026-09-25T09:00:00.000Z",
		UpdatedAt:   "2026-09-25T10:00:00.000Z",
		Session:     stringPointer("session-1"),
		Worktree:    stringPointer("/work/feature"),
		Branch:      stringPointer("feat/add-thing"),
		Body:        "1 行目\n\n2 行目\n",
	}
}

func specChildMemory() Issue {
	return Issue{
		ID:        "2",
		Title:     "child",
		Status:    "todo",
		Labels:    []string{},
		Parent:    stringPointer("1"),
		Blocks:    []string{"1"},
		BlockedBy: []string{},
		Children:  []string{},
		CreatedAt: "2026-09-25T09:00:00.000Z",
		UpdatedAt: "2026-09-25T09:00:00.000Z",
		Session:   stringPointer("session-1"),
		Worktree:  stringPointer("/work/feature"),
		Branch:    stringPointer("feat/add-thing"),
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

func withPriority(id string, priority string) Issue {
	issue := bareIssue(id)
	if priority != "" {
		issue.Priority = stringPointer(priority)
	}
	return issue
}

func withDue(id string, dueDate string, priority string) Issue {
	issue := withPriority(id, priority)
	if dueDate != "" {
		issue.DueDate = stringPointer(dueDate)
	}
	return issue
}

func ids(issues []Issue) string {
	return joinIDs(issueIDs(issues))
}

func issueIDs(issues []Issue) []string {
	result := make([]string, 0, len(issues))
	for _, issue := range issues {
		result = append(result, issue.ID)
	}
	return result
}

func joinIDs(values []string) string {
	return strings.Join(values, ",")
}

func filterCompleted(issues []Issue, visibility string, now time.Time) []Issue {
	matched := []Issue{}
	for _, issue := range issues {
		if MatchesCompletedVisibility(issue, visibility, now) {
			matched = append(matched, issue)
		}
	}
	return matched
}

func filterIssues(issues []Issue, filter resolvedFilter, now time.Time) []Issue {
	matched := []Issue{}
	for _, issue := range issues {
		if issueMatches(issue, filter, now) {
			matched = append(matched, issue)
		}
	}
	return matched
}

func mustPatch(t *testing.T, value any) []PatchOp {
	t.Helper()
	ops, err := ParsePatch(value)
	if err != nil {
		t.Fatal(err)
	}
	return ops
}

func testWorkspace(t *testing.T) workspace.Workspace {
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

func gitWorkspace(t *testing.T) workspace.Workspace {
	t.Helper()
	root := t.TempDir()
	t.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("TZ", "Asia/Tokyo")
	t.Setenv("YARU_NOW", "2026-09-28T12:00:00.000Z")
	t.Chdir(root)
	git(t, "init", "-q", "-b", "develop")
	git(t, "config", "user.name", "Spec Author")
	git(t, "config", "user.email", "spec@example.com")
	directory := filepath.Join(root, ".yaru")
	if err := os.MkdirAll(filepath.Join(directory, "issues"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "config.yml"), []byte{}, 0o644); err != nil {
		t.Fatal(err)
	}
	return workspace.Workspace{Root: root, Directory: directory}
}

func git(t *testing.T, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, output)
	}
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func expectFile(t *testing.T, path string, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != expected {
		t.Fatalf("file %s\nexpected:\n%s\nactual:\n%s", path, expected, content)
	}
}

func containsLine(text string, line string) bool {
	return strings.Contains("\n"+text+"\n", "\n"+line+"\n")
}

func nan() float64 {
	return math.NaN()
}
