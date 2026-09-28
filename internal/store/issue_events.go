//declscope:namespace issue

package store

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/fsutil"
	"github.com/aovoq/yaru/internal/workspace"
)

// issue の属性がいつ・誰に・どのセッションで変わったかを .yaru/events/<id>.jsonl へ追記する。
// 同じパッケージの別ファイルに置き、store と events の import 循環を避ける。
// 1 行は JSON.stringify の 1 引数。https://www.rfc-editor.org/rfc/rfc8259
// https://jsonlines.org/
// src/issue-events.ts、docs/spec/yaru-format.md の「event」。

// trackedIssueFields は履歴に残す属性。この順に、変わったものだけを出す。
// 本文と時刻の派生値は残さない。src/issue-events.ts:12-21
var trackedIssueFields = []string{"title", "status", "assignee", "labels", "dueDate", "priority", "parent", "blocks"}

// TrackedIssueFields は履歴に残す属性の写しを返す。
func TrackedIssueFields() []string {
	return append([]string{}, trackedIssueFields...)
}

// IssueEvent は 1 行の履歴。キー順は field, from, to, by, session, at。src/issue-events.ts:26-35
type IssueEvent struct {
	Field   string  `json:"field"`
	From    any     `json:"from"`
	To      any     `json:"to"`
	By      string  `json:"by"`
	Session *string `json:"session"`
	At      string  `json:"at"`
}

// IssueChange は保存の前後の差。src/issue-events.ts:37
type IssueChange struct {
	Field string
	From  any
	To    any
}

// IssueEventContext は誰が、どのセッションで、いつ保存したか。src/issue-events.ts:54
type IssueEventContext struct {
	By      string
	Session *string
	At      string
}

// DiffIssue は追跡する属性だけを、TrackedIssueFields の順で返す。src/issue-events.ts:39-47
func DiffIssue(before Issue, after Issue) []IssueChange {
	changes := []IssueChange{}
	if before.Title != after.Title {
		changes = append(changes, IssueChange{Field: "title", From: before.Title, To: after.Title})
	}
	if before.Status != after.Status {
		changes = append(changes, IssueChange{Field: "status", From: before.Status, To: after.Status})
	}
	if !issueSameOptionalString(before.Assignee, after.Assignee) {
		changes = append(changes, IssueChange{Field: "assignee", From: issueStringOrNil(before.Assignee), To: issueStringOrNil(after.Assignee)})
	}
	if !issueSameStrings(before.Labels, after.Labels) {
		changes = append(changes, IssueChange{Field: "labels", From: issueCopyStrings(before.Labels), To: issueCopyStrings(after.Labels)})
	}
	if !issueSameOptionalString(before.DueDate, after.DueDate) {
		changes = append(changes, IssueChange{Field: "dueDate", From: issueStringOrNil(before.DueDate), To: issueStringOrNil(after.DueDate)})
	}
	if !issueSameOptionalString(before.Priority, after.Priority) {
		changes = append(changes, IssueChange{Field: "priority", From: issueStringOrNil(before.Priority), To: issueStringOrNil(after.Priority)})
	}
	if !issueSameOptionalString(before.Parent, after.Parent) {
		changes = append(changes, IssueChange{Field: "parent", From: issueStringOrNil(before.Parent), To: issueStringOrNil(after.Parent)})
	}
	if !issueSameStrings(before.Blocks, after.Blocks) {
		changes = append(changes, IssueChange{Field: "blocks", From: issueCopyStrings(before.Blocks), To: issueCopyStrings(after.Blocks)})
	}
	return changes
}

// AppendIssueEvents は差が 1 つも無ければファイルもディレクトリも作らない。
// 既存のファイルが改行で終わっていなくても、末尾へ足す。src/issue-events.ts:50-63
// イベントファイルだけをロックする。issue ファイルのロックは取り直さない。
func AppendIssueEvents(ctx context.Context, space workspace.Workspace, issueID string, changes []IssueChange, eventContext IssueEventContext) error {
	if len(changes) == 0 {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	directory := filepath.Join(space.Directory, "events")
	if err := os.MkdirAll(directory, 0o777); err != nil {
		return err
	}
	eventPath := filepath.Join(directory, issueID+".jsonl")
	unlock, err := fsutil.Lock(ctx, eventPath)
	if err != nil {
		return err
	}
	defer unlock()
	lines := make([]string, 0, len(changes))
	for _, change := range changes {
		encoded, err := document.MarshalJavaScript(IssueEvent{
			Field:   change.Field,
			From:    change.From,
			To:      change.To,
			By:      eventContext.By,
			Session: eventContext.Session,
			At:      eventContext.At,
		})
		if err != nil {
			return err
		}
		lines = append(lines, string(encoded))
	}
	payload := strings.Join(lines, "\n") + "\n"
	file, err := os.OpenFile(eventPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o666)
	if err != nil {
		return err
	}
	_, writeErr := file.WriteString(payload)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}

// IssueEvents は issue のファイルが無いときだけエラーにする。壊れた行は飛ばし、ファイルは消さない。
// src/issue-events.ts:65-78
func IssueEvents(ctx context.Context, space workspace.Workspace, issueID string) ([]IssueEvent, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	issuePath := filepath.Join(space.Directory, "issues", issueID+".md")
	if _, err := os.Stat(issuePath); err != nil {
		if os.IsNotExist(err) {
			return nil, issueErrString("issue not found: " + issueID)
		}
		return nil, err
	}
	content, err := os.ReadFile(filepath.Join(space.Directory, "events", issueID+".jsonl"))
	if err != nil {
		if os.IsNotExist(err) {
			return []IssueEvent{}, nil
		}
		return nil, err
	}
	events := []IssueEvent{}
	for _, line := range strings.Split(string(content), "\n") {
		if document.Trim(line) == "" {
			continue
		}
		event, ok := issueParseEventLine(line)
		if !ok {
			continue
		}
		events = append(events, event)
	}
	return events, nil
}

func issueParseEventLine(line string) (IssueEvent, bool) {
	var raw map[string]json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader([]byte(line)))
	decoder.UseNumber()
	if err := decoder.Decode(&raw); err != nil {
		return IssueEvent{}, false
	}
	if decoder.More() {
		return IssueEvent{}, false
	}
	field, ok := issueRawString(raw["field"])
	if !ok || !issueIsTrackedField(field) {
		return IssueEvent{}, false
	}
	from, ok := issueRawEventValue(raw["from"])
	if !ok {
		return IssueEvent{}, false
	}
	to, ok := issueRawEventValue(raw["to"])
	if !ok {
		return IssueEvent{}, false
	}
	by, ok := issueRawString(raw["by"])
	if !ok {
		return IssueEvent{}, false
	}
	at, ok := issueRawString(raw["at"])
	if !ok {
		return IssueEvent{}, false
	}
	session, ok := issueRawSession(raw["session"])
	if !ok {
		return IssueEvent{}, false
	}
	return IssueEvent{Field: field, From: from, To: to, By: by, Session: session, At: at}, true
}

func issueIsTrackedField(field string) bool {
	for _, tracked := range TrackedIssueFields() {
		if tracked == field {
			return true
		}
	}
	return false
}

func issueRawString(raw json.RawMessage) (string, bool) {
	if len(bytes.TrimSpace(raw)) == 0 || raw[0] != '"' {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

func issueRawSession(raw json.RawMessage) (*string, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, false
	}
	if string(trimmed) == "null" {
		return nil, true
	}
	value, ok := issueRawString(trimmed)
	if !ok {
		return nil, false
	}
	return issueStringPointer(value), true
}

func issueRawEventValue(raw json.RawMessage) (any, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, false
	}
	switch trimmed[0] {
	case 'n':
		if string(trimmed) == "null" {
			return nil, true
		}
		return nil, false
	case '"':
		value, ok := issueRawString(trimmed)
		if !ok {
			return nil, false
		}
		return value, true
	case '[':
		var items []string
		if err := json.Unmarshal(trimmed, &items); err != nil {
			return nil, false
		}
		if items == nil {
			items = []string{}
		}
		return items, true
	default:
		return nil, false
	}
}

func issueStringOrNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
