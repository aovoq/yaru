//declscope:namespace issue

package store

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/fsutil"
	"github.com/aovoq/yaru/internal/workspace"
)

// SaveIssue は issue を作るか更新する。書く前に staleAfter を読み、不正なら何も書かない。
// 作成だけではイベントを足さない。src/store.ts:248-315、docs/spec/yaru-format.md の「issue」。
// issues ディレクトリを先にロックし、更新対象のファイルもロックする。イベントの追記までその中で行う。
func SaveIssue(ctx context.Context, space workspace.Workspace, input SaveInput, options SaveOptions) (Issue, error) {
	if err := ctx.Err(); err != nil {
		return Issue{}, err
	}
	nowISO := issueIsoTimestamp(options.Now)
	staleAfter, err := ReadStaleAfter(ctx, space)
	if err != nil {
		return Issue{}, err
	}
	var session *string
	if options.Provenance != nil {
		session = options.Provenance.Session
	}
	eventContext := IssueEventContext{By: options.Author, Session: session, At: nowISO}
	assignee, err := issueResolveAssignee(input.Assignee, options.Author)
	if err != nil {
		return Issue{}, err
	}
	dueDate, err := issueResolveDueDate(input.DueDate)
	if err != nil {
		return Issue{}, err
	}
	priority, err := ResolvePriority(input.Priority)
	if err != nil {
		return Issue{}, err
	}
	var status string
	if input.Status.Set {
		text := ""
		if input.Status.Value != nil {
			text = *input.Status.Value
		}
		status, err = issueResolveStatus(text)
		if err != nil {
			return Issue{}, err
		}
	}
	var patch []PatchOp
	if input.PatchSet {
		patch, err = ParsePatch(input.Patch)
		if err != nil {
			return Issue{}, err
		}
	}
	if input.PatchSet && input.Body.Set {
		return Issue{}, issueErrString("cannot pass body and patch together")
	}
	if input.PatchSet && input.ID == "" {
		return Issue{}, issueErrString("patch is only valid when updating an existing issue")
	}
	unlockDirectory, err := fsutil.Lock(ctx, filepath.Join(space.Directory, "issues"))
	if err != nil {
		return Issue{}, err
	}
	defer unlockDirectory()
	all, err := loadRawIssues(space, options.Author)
	if err != nil {
		return Issue{}, err
	}
	if input.ID != "" {
		return updateIssue(ctx, space, input, options, all, options.Now, nowISO, staleAfter, assignee, dueDate, priority, status, patch, eventContext)
	}
	return createIssue(ctx, space, input, options, all, options.Now, nowISO, staleAfter, assignee, dueDate, priority, status, eventContext)
}

func updateIssue(
	ctx context.Context,
	space workspace.Workspace,
	input SaveInput,
	options SaveOptions,
	all []Issue,
	moment time.Time,
	nowISO string,
	staleAfter int64,
	assignee Optional[string],
	dueDate Optional[string],
	priority Optional[string],
	status string,
	patch []PatchOp,
	eventContext IssueEventContext,
) (Issue, error) {
	path := issuePath(space, input.ID)
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return Issue{}, issueErrString("issue not found: " + input.ID)
		}
		return Issue{}, err
	}
	unlockIssue, err := fsutil.Lock(ctx, path)
	if err != nil {
		return Issue{}, err
	}
	defer unlockIssue()
	current, err := readIssue(path, input.ID, options.Author)
	if err != nil {
		return Issue{}, err
	}
	if input.Title.Set {
		if input.Title.Value == nil || document.Trim(*input.Title.Value) == "" {
			actual := "null"
			if input.Title.Value != nil {
				quoted, quoteErr := document.Quote(*input.Title.Value)
				if quoteErr != nil {
					return Issue{}, quoteErr
				}
				actual = quoted
			}
			return Issue{}, issueErrString("invalid title: expected a non-empty string, actual " + actual)
		}
	}
	nextStatus := current.Status
	if input.Status.Set {
		nextStatus = status
	}
	times := issueStatusTimestamps(&current, nextStatus, nowISO)
	parent := current.Parent
	if input.Parent.Set {
		parent, err = issueResolveParent(input.ID, input.Parent, all)
		if err != nil {
			return Issue{}, err
		}
	}
	relations, err := issueResolveBlocks(input.ID, current.Blocks, input, all)
	if err != nil {
		return Issue{}, err
	}
	next := current
	if input.Title.Set {
		next.Title = document.Trim(*input.Title.Value)
	}
	next.Status = nextStatus
	if assignee.Set {
		next.Assignee = assignee.Value
	}
	if input.Labels.Set {
		next.Labels = issueCopyStrings(issueOptionalSlice(input.Labels))
	}
	if dueDate.Set {
		next.DueDate = dueDate.Value
	}
	if priority.Set {
		next.Priority = priority.Value
	}
	next.Parent = parent
	next.Blocks = relations.blocks
	next.StartedAt = times.startedAt
	next.CompletedAt = times.completedAt
	next.CanceledAt = times.canceledAt
	if input.PatchSet {
		body, patchErr := issueApplyPatch(current.Body, patch)
		if patchErr != nil {
			return Issue{}, patchErr
		}
		next.Body = body
	} else if input.Body.Set && input.Body.Value != nil {
		next.Body = *input.Body.Value
	}
	next.UpdatedAt = nowISO
	if options.Provenance != nil {
		next.Session = options.Provenance.Session
		next.Worktree = options.Provenance.Worktree
		next.Branch = options.Provenance.Branch
	}
	if err := fsutil.WriteReplace(path, formatIssue(next)); err != nil {
		return Issue{}, err
	}
	if err := AppendIssueEvents(ctx, space, next.ID, DiffIssue(current, next), eventContext); err != nil {
		return Issue{}, err
	}
	if err := issueWriteBlockOwners(ctx, space, relations.owners, nowISO, eventContext, options.Author); err != nil {
		return Issue{}, err
	}
	return readDerivedIssue(space, next.ID, moment, staleAfter, options.Author)
}

func createIssue(
	ctx context.Context,
	space workspace.Workspace,
	input SaveInput,
	options SaveOptions,
	all []Issue,
	moment time.Time,
	nowISO string,
	staleAfter int64,
	assignee Optional[string],
	dueDate Optional[string],
	priority Optional[string],
	status string,
	eventContext IssueEventContext,
) (Issue, error) {
	for {
		issueID, err := nextIssueID(space)
		if err != nil {
			return Issue{}, err
		}
		created, err := newIssue(issueID, input, assignee, dueDate, priority, status, nowISO, options.Provenance)
		if err != nil {
			return Issue{}, err
		}
		if input.Parent.Set {
			created.Parent, err = issueResolveParent(created.ID, input.Parent, all)
			if err != nil {
				return Issue{}, err
			}
		}
		relations, err := issueResolveBlocks(created.ID, nil, input, all)
		if err != nil {
			return Issue{}, err
		}
		created.Blocks = relations.blocks
		err = fsutil.WriteCreate(issuePath(space, created.ID), formatIssue(created))
		if err != nil {
			if issueIsExist(err) {
				continue
			}
			return Issue{}, err
		}
		if err := issueWriteBlockOwners(ctx, space, relations.owners, nowISO, eventContext, options.Author); err != nil {
			return Issue{}, err
		}
		return readDerivedIssue(space, created.ID, moment, staleAfter, options.Author)
	}
}

func newIssue(
	issueID string,
	input SaveInput,
	assignee Optional[string],
	dueDate Optional[string],
	priority Optional[string],
	status string,
	nowISO string,
	provenance *Provenance,
) (Issue, error) {
	if !input.Title.Set || input.Title.Value == nil || document.Trim(*input.Title.Value) == "" {
		return Issue{}, issueErrString("title is required when creating an issue")
	}
	if !input.Status.Set {
		status = "todo"
	}
	times := issueStatusTimestamps(nil, status, nowISO)
	issue := Issue{
		ID:          issueID,
		Title:       document.Trim(*input.Title.Value),
		Status:      status,
		Labels:      []string{},
		Blocks:      []string{},
		BlockedBy:   []string{},
		Children:    []string{},
		CreatedAt:   nowISO,
		UpdatedAt:   nowISO,
		StartedAt:   times.startedAt,
		CompletedAt: times.completedAt,
		CanceledAt:  times.canceledAt,
	}
	if assignee.Set {
		issue.Assignee = assignee.Value
	}
	if input.Labels.Set {
		issue.Labels = issueCopyStrings(issueOptionalSlice(input.Labels))
	}
	if dueDate.Set {
		issue.DueDate = dueDate.Value
	}
	if priority.Set {
		issue.Priority = priority.Value
	}
	if input.Body.Set && input.Body.Value != nil {
		issue.Body = *input.Body.Value
	}
	if provenance != nil {
		issue.Session = provenance.Session
		issue.Worktree = provenance.Worktree
		issue.Branch = provenance.Branch
	}
	return issue, nil
}

type issueStatusTimes struct {
	startedAt   *string
	completedAt *string
	canceledAt  *string
}

func issueStatusTimestamps(current *Issue, status string, nowISO string) issueStatusTimes {
	times := issueStatusTimes{}
	if current != nil && current.StartedAt != nil {
		times.startedAt = current.StartedAt
	} else if status == "in_progress" {
		times.startedAt = issueStringPointer(nowISO)
	}
	if status == "done" {
		if current != nil && current.Status == "done" {
			times.completedAt = current.CompletedAt
		} else {
			times.completedAt = issueStringPointer(nowISO)
		}
	}
	if status == "canceled" {
		if current != nil && current.Status == "canceled" {
			times.canceledAt = current.CanceledAt
		} else {
			times.canceledAt = issueStringPointer(nowISO)
		}
	}
	return times
}

func issueResolveParent(issueID string, value Optional[string], all []Issue) (*string, error) {
	resolved := BlankToNull(value)
	if !resolved.Set || resolved.Value == nil {
		return nil, nil
	}
	parent := *resolved.Value
	if parent == issueID {
		return nil, issueErrString("invalid parent: an issue cannot be its own parent, actual " + issueID)
	}
	found := false
	for _, issue := range all {
		if issue.ID == parent {
			found = true
			break
		}
	}
	if !found {
		return nil, issueErrString("invalid parent: issue not found: " + parent)
	}
	if issueIsDescendant(all, parent, issueID) {
		return nil, issueErrString("invalid parent: cycle: " + parent + " is a descendant of " + issueID)
	}
	return issueStringPointer(parent), nil
}

func issueIsDescendant(all []Issue, node string, ancestor string) bool {
	byID := map[string]Issue{}
	for _, issue := range all {
		byID[issue.ID] = issue
	}
	seen := map[string]struct{}{}
	current, ok := byID[node]
	if !ok {
		return false
	}
	for current.Parent != nil {
		parent := *current.Parent
		if parent == ancestor {
			return true
		}
		if _, exists := seen[parent]; exists {
			return true
		}
		seen[parent] = struct{}{}
		current, ok = byID[parent]
		if !ok {
			return false
		}
	}
	return false
}

type issueBlockRelations struct {
	blocks []string
	owners []issueBlockOwner
}

type issueBlockOwner struct {
	id     string
	blocks []string
}

func issueResolveBlocks(issueID string, currentBlocks []string, input SaveInput, all []Issue) (issueBlockRelations, error) {
	addBlocks, addSet := issueOptionalList(input.AddBlocks)
	removeBlocks, removeSet := issueOptionalList(input.RemoveBlocks)
	addBlockedBy, addBySet := issueOptionalList(input.AddBlockedBy)
	removeBlockedBy, removeBySet := issueOptionalList(input.RemoveBlockedBy)
	if input.Blocks.Set && (addSet || removeSet || addBySet || removeBySet) {
		return issueBlockRelations{}, issueErrString("cannot pass blocks with addBlocks, removeBlocks, addBlockedBy, or removeBlockedBy")
	}
	blocks := issueCopyStrings(currentBlocks)
	if input.Blocks.Set {
		blocks = issueUniqueStrings(issueOptionalSlice(input.Blocks))
	} else {
		if removeSet {
			remove := map[string]struct{}{}
			for _, id := range removeBlocks {
				remove[id] = struct{}{}
			}
			filtered := []string{}
			for _, id := range blocks {
				if _, exists := remove[id]; !exists {
					filtered = append(filtered, id)
				}
			}
			blocks = filtered
		}
		if addSet {
			blocks = issueUniqueStrings(append(issueCopyStrings(blocks), addBlocks...))
		}
	}

	graph := map[string][]string{}
	for _, issue := range all {
		graph[issue.ID] = issueCopyStrings(issue.Blocks)
	}
	if _, ok := graph[issueID]; !ok {
		graph[issueID] = []string{}
	}
	graph[issueID] = issueCopyStrings(blocks)

	owners := map[string][]string{}
	ownerOrder := []string{}
	ownerBlocks := func(id string) ([]string, error) {
		if existing, ok := owners[id]; ok {
			return existing, nil
		}
		for _, issue := range all {
			if issue.ID == id {
				copied := issueCopyStrings(issue.Blocks)
				owners[id] = copied
				ownerOrder = append(ownerOrder, id)
				return copied, nil
			}
		}
		return nil, issueErrString("invalid block: issue not found: " + id)
	}

	if removeBySet {
		for _, id := range removeBlockedBy {
			current, err := ownerBlocks(id)
			if err != nil {
				return issueBlockRelations{}, err
			}
			filtered := []string{}
			for _, block := range current {
				if block != issueID {
					filtered = append(filtered, block)
				}
			}
			owners[id] = filtered
			graph[id] = filtered
		}
	}
	if addBySet {
		for _, id := range issueUniqueStrings(addBlockedBy) {
			if id == issueID {
				return issueBlockRelations{}, issueErrString("invalid block: an issue cannot block itself, actual " + issueID)
			}
			current, err := ownerBlocks(id)
			if err != nil {
				return issueBlockRelations{}, err
			}
			next := issueUniqueStrings(append(issueCopyStrings(current), issueID))
			owners[id] = next
			graph[id] = next
		}
	}
	for _, to := range blocks {
		if to == issueID {
			return issueBlockRelations{}, issueErrString("invalid block: an issue cannot block itself, actual " + issueID)
		}
		found := false
		for _, issue := range all {
			if issue.ID == to {
				found = true
				break
			}
		}
		if !found {
			return issueBlockRelations{}, issueErrString("invalid block: issue not found: " + to)
		}
	}
	newEdges := [][2]string{}
	for _, to := range blocks {
		if !issueContainsString(currentBlocks, to) {
			newEdges = append(newEdges, [2]string{issueID, to})
		}
	}
	if addBySet {
		for _, id := range issueUniqueStrings(addBlockedBy) {
			newEdges = append(newEdges, [2]string{id, issueID})
		}
	}
	for _, edge := range newEdges {
		if issueHasPath(graph, edge[1], edge[0]) {
			return issueBlockRelations{}, issueErrString("invalid block: cycle: " + edge[0] + " already blocked by " + edge[1])
		}
	}
	ownerList := make([]issueBlockOwner, 0, len(ownerOrder))
	for _, id := range ownerOrder {
		ownerList = append(ownerList, issueBlockOwner{id: id, blocks: owners[id]})
	}
	return issueBlockRelations{blocks: blocks, owners: ownerList}, nil
}

func issueHasPath(graph map[string][]string, from string, to string) bool {
	seen := map[string]struct{}{}
	stack := []string{from}
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if node == to {
			return true
		}
		if _, exists := seen[node]; exists {
			continue
		}
		seen[node] = struct{}{}
		stack = append(stack, graph[node]...)
	}
	return false
}

func issueWriteBlockOwners(ctx context.Context, space workspace.Workspace, owners []issueBlockOwner, nowISO string, eventContext IssueEventContext, author string) error {
	for _, owner := range owners {
		if err := issueWriteBlockOwner(ctx, space, owner, nowISO, eventContext, author); err != nil {
			return err
		}
	}
	return nil
}

func issueWriteBlockOwner(ctx context.Context, space workspace.Workspace, owner issueBlockOwner, nowISO string, eventContext IssueEventContext, author string) error {
	path := issuePath(space, owner.id)
	unlock, err := fsutil.Lock(ctx, path)
	if err != nil {
		return err
	}
	defer unlock()
	issue, err := readIssue(path, owner.id, author)
	if err != nil {
		return err
	}
	next := issue
	next.Blocks = issueCopyStrings(owner.blocks)
	next.UpdatedAt = nowISO
	if err := fsutil.WriteReplace(path, formatIssue(next)); err != nil {
		return err
	}
	return AppendIssueEvents(ctx, space, owner.id, DiffIssue(issue, next), eventContext)
}

func issueOptionalList(value Optional[[]string]) ([]string, bool) {
	if !value.Set {
		return nil, false
	}
	return issueOptionalSlice(value), true
}

func issueOptionalSlice(value Optional[[]string]) []string {
	if value.Value == nil {
		return []string{}
	}
	return *value.Value
}
