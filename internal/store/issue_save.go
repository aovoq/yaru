//declscope:namespace issue

package store

import (
	"os"
	"time"

	"github.com/aovoq/yaru/internal/workspace"
)

// SaveIssue は issue を作るか更新する。書く前に staleAfter を読み、不正なら何も書かない。
// 作成だけではイベントを足さない。src/store.ts:248-315、docs/spec/yaru-format.md の「issue」。
func SaveIssue(space workspace.Workspace, input SaveInput, options SaveOptions) (Issue, error) {
	moment, err := currentMoment(options.Now)
	if err != nil {
		return Issue{}, err
	}
	nowISO := isoTimestamp(moment)
	staleAfter, err := ReadStaleAfter(space)
	if err != nil {
		return Issue{}, err
	}
	gitAuthor, err := currentGitName()
	if err != nil {
		return Issue{}, err
	}
	var session *string
	if options.Provenance != nil {
		session = options.Provenance.Session
	}
	eventContext := IssueEventContext{By: gitAuthor, Session: session, At: nowISO}
	assignee, err := resolveAssignee(input.Assignee)
	if err != nil {
		return Issue{}, err
	}
	dueDate, err := resolveDueDate(input.DueDate)
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
		status, err = resolveStatus(text)
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
		return Issue{}, errString("cannot pass body and patch together")
	}
	if input.PatchSet && input.ID == "" {
		return Issue{}, errString("patch is only valid when updating an existing issue")
	}
	all, err := loadRawIssues(space)
	if err != nil {
		return Issue{}, err
	}
	if input.ID != "" {
		return updateIssue(space, input, options, all, moment, nowISO, staleAfter, assignee, dueDate, priority, status, patch, eventContext)
	}
	return createIssue(space, input, options, all, moment, nowISO, staleAfter, assignee, dueDate, priority, status, eventContext)
}

func updateIssue(
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
			return Issue{}, errString("issue not found: " + input.ID)
		}
		return Issue{}, err
	}
	current, err := readIssue(path, input.ID)
	if err != nil {
		return Issue{}, err
	}
	if input.Title.Set {
		if input.Title.Value == nil || javascriptTrim(*input.Title.Value) == "" {
			actual := "null"
			if input.Title.Value != nil {
				quoted, quoteErr := quoteJavaScript(*input.Title.Value)
				if quoteErr != nil {
					return Issue{}, quoteErr
				}
				actual = quoted
			}
			return Issue{}, errString("invalid title: expected a non-empty string, actual " + actual)
		}
	}
	nextStatus := current.Status
	if input.Status.Set {
		nextStatus = status
	}
	times := statusTimestamps(&current, nextStatus, nowISO)
	parent := current.Parent
	if input.Parent.Set {
		parent, err = resolveParent(input.ID, input.Parent, all)
		if err != nil {
			return Issue{}, err
		}
	}
	relations, err := resolveBlocks(input.ID, current.Blocks, input, all)
	if err != nil {
		return Issue{}, err
	}
	next := current
	if input.Title.Set {
		next.Title = javascriptTrim(*input.Title.Value)
	}
	next.Status = nextStatus
	if assignee.Set {
		next.Assignee = assignee.Value
	}
	if input.Labels.Set {
		next.Labels = copyStrings(optionalSlice(input.Labels))
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
		body, patchErr := applyPatch(current.Body, patch)
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
	if err := writeReplace(path, formatIssue(next)); err != nil {
		return Issue{}, err
	}
	if err := AppendIssueEvents(space, next.ID, DiffIssue(current, next), eventContext); err != nil {
		return Issue{}, err
	}
	if err := writeBlockOwners(space, relations.owners, nowISO, eventContext); err != nil {
		return Issue{}, err
	}
	return readDerivedIssue(space, next.ID, moment, staleAfter)
}

func createIssue(
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
			created.Parent, err = resolveParent(created.ID, input.Parent, all)
			if err != nil {
				return Issue{}, err
			}
		}
		relations, err := resolveBlocks(created.ID, nil, input, all)
		if err != nil {
			return Issue{}, err
		}
		created.Blocks = relations.blocks
		err = writeCreate(issuePath(space, created.ID), formatIssue(created))
		if err != nil {
			if isExist(err) {
				continue
			}
			return Issue{}, err
		}
		if err := writeBlockOwners(space, relations.owners, nowISO, eventContext); err != nil {
			return Issue{}, err
		}
		return readDerivedIssue(space, created.ID, moment, staleAfter)
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
	if !input.Title.Set || input.Title.Value == nil || javascriptTrim(*input.Title.Value) == "" {
		return Issue{}, errString("title is required when creating an issue")
	}
	if !input.Status.Set {
		status = "todo"
	}
	times := statusTimestamps(nil, status, nowISO)
	issue := Issue{
		ID:          issueID,
		Title:       javascriptTrim(*input.Title.Value),
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
		issue.Labels = copyStrings(optionalSlice(input.Labels))
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

type statusTimes struct {
	startedAt   *string
	completedAt *string
	canceledAt  *string
}

func statusTimestamps(current *Issue, status string, nowISO string) statusTimes {
	times := statusTimes{}
	if current != nil && current.StartedAt != nil {
		times.startedAt = current.StartedAt
	} else if status == "in_progress" {
		times.startedAt = stringPointer(nowISO)
	}
	if status == "done" {
		if current != nil && current.Status == "done" {
			times.completedAt = current.CompletedAt
		} else {
			times.completedAt = stringPointer(nowISO)
		}
	}
	if status == "canceled" {
		if current != nil && current.Status == "canceled" {
			times.canceledAt = current.CanceledAt
		} else {
			times.canceledAt = stringPointer(nowISO)
		}
	}
	return times
}

func resolveParent(issueID string, value Optional[string], all []Issue) (*string, error) {
	resolved := BlankToNull(value)
	if !resolved.Set || resolved.Value == nil {
		return nil, nil
	}
	parent := *resolved.Value
	if parent == issueID {
		return nil, errString("invalid parent: an issue cannot be its own parent, actual " + issueID)
	}
	found := false
	for _, issue := range all {
		if issue.ID == parent {
			found = true
			break
		}
	}
	if !found {
		return nil, errString("invalid parent: issue not found: " + parent)
	}
	if isDescendant(all, parent, issueID) {
		return nil, errString("invalid parent: cycle: " + parent + " is a descendant of " + issueID)
	}
	return stringPointer(parent), nil
}

func isDescendant(all []Issue, node string, ancestor string) bool {
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

type blockRelations struct {
	blocks []string
	owners []blockOwner
}

type blockOwner struct {
	id     string
	blocks []string
}

func resolveBlocks(issueID string, currentBlocks []string, input SaveInput, all []Issue) (blockRelations, error) {
	addBlocks, addSet := optionalList(input.AddBlocks)
	removeBlocks, removeSet := optionalList(input.RemoveBlocks)
	addBlockedBy, addBySet := optionalList(input.AddBlockedBy)
	removeBlockedBy, removeBySet := optionalList(input.RemoveBlockedBy)
	if input.Blocks.Set && (addSet || removeSet || addBySet || removeBySet) {
		return blockRelations{}, errString("cannot pass blocks with addBlocks, removeBlocks, addBlockedBy, or removeBlockedBy")
	}
	blocks := copyStrings(currentBlocks)
	if input.Blocks.Set {
		blocks = uniqueStrings(optionalSlice(input.Blocks))
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
			blocks = uniqueStrings(append(copyStrings(blocks), addBlocks...))
		}
	}

	graph := map[string][]string{}
	for _, issue := range all {
		graph[issue.ID] = copyStrings(issue.Blocks)
	}
	if _, ok := graph[issueID]; !ok {
		graph[issueID] = []string{}
	}
	graph[issueID] = copyStrings(blocks)

	owners := map[string][]string{}
	ownerOrder := []string{}
	ownerBlocks := func(id string) ([]string, error) {
		if existing, ok := owners[id]; ok {
			return existing, nil
		}
		for _, issue := range all {
			if issue.ID == id {
				copied := copyStrings(issue.Blocks)
				owners[id] = copied
				ownerOrder = append(ownerOrder, id)
				return copied, nil
			}
		}
		return nil, errString("invalid block: issue not found: " + id)
	}

	if removeBySet {
		for _, id := range removeBlockedBy {
			current, err := ownerBlocks(id)
			if err != nil {
				return blockRelations{}, err
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
		for _, id := range uniqueStrings(addBlockedBy) {
			if id == issueID {
				return blockRelations{}, errString("invalid block: an issue cannot block itself, actual " + issueID)
			}
			current, err := ownerBlocks(id)
			if err != nil {
				return blockRelations{}, err
			}
			next := uniqueStrings(append(copyStrings(current), issueID))
			owners[id] = next
			graph[id] = next
		}
	}
	for _, to := range blocks {
		if to == issueID {
			return blockRelations{}, errString("invalid block: an issue cannot block itself, actual " + issueID)
		}
		found := false
		for _, issue := range all {
			if issue.ID == to {
				found = true
				break
			}
		}
		if !found {
			return blockRelations{}, errString("invalid block: issue not found: " + to)
		}
	}
	newEdges := [][2]string{}
	for _, to := range blocks {
		if !containsString(currentBlocks, to) {
			newEdges = append(newEdges, [2]string{issueID, to})
		}
	}
	if addBySet {
		for _, id := range uniqueStrings(addBlockedBy) {
			newEdges = append(newEdges, [2]string{id, issueID})
		}
	}
	for _, edge := range newEdges {
		if hasPath(graph, edge[1], edge[0]) {
			return blockRelations{}, errString("invalid block: cycle: " + edge[0] + " already blocked by " + edge[1])
		}
	}
	ownerList := make([]blockOwner, 0, len(ownerOrder))
	for _, id := range ownerOrder {
		ownerList = append(ownerList, blockOwner{id: id, blocks: owners[id]})
	}
	return blockRelations{blocks: blocks, owners: ownerList}, nil
}

func hasPath(graph map[string][]string, from string, to string) bool {
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

func writeBlockOwners(space workspace.Workspace, owners []blockOwner, nowISO string, eventContext IssueEventContext) error {
	for _, owner := range owners {
		path := issuePath(space, owner.id)
		issue, err := readIssue(path, owner.id)
		if err != nil {
			return err
		}
		next := issue
		next.Blocks = copyStrings(owner.blocks)
		next.UpdatedAt = nowISO
		if err := writeReplace(path, formatIssue(next)); err != nil {
			return err
		}
		if err := AppendIssueEvents(space, owner.id, DiffIssue(issue, next), eventContext); err != nil {
			return err
		}
	}
	return nil
}

func optionalList(value Optional[[]string]) ([]string, bool) {
	if !value.Set {
		return nil, false
	}
	return optionalSlice(value), true
}

func optionalSlice(value Optional[[]string]) []string {
	if value.Value == nil {
		return []string{}
	}
	return *value.Value
}
