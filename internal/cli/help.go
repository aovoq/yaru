//declscope:namespace cli

// ヘルプの文字列。TS 版の src/index.ts:33-268 とバイト単位で同じ
package cli

import (
	"fmt"

	"github.com/aovoq/yaru/internal/server"
)

func globalHelp() string {
	// src/index.ts:33-52。port は src/web.tsx:46 の DEFAULT_PORT
	return fmt.Sprintf(`yaru — local issues, markdown in .yaru

  yaru init
  yaru issue list
  yaru issue get <id>
  yaru issue save
  yaru comment list --issue ID
  yaru comment get <id>
  yaru comment save
  yaru question list
  yaru question get <id>
  yaru question save
  yaru question answer <id>
  yaru question wait <id>
  yaru serve [-p|--port %d]

Output is JSON unless -f / --format. Commands print their contract with --help.

yaru serve shows every workspace yaru has been used in: / lists them, /p/<name>/ is one board.
`, server.DefaultPort)
}

const issueHelp = `yaru issue — list, get, or save issues

  yaru issue list
  yaru issue get <id>
  yaru issue save

Each subcommand documents its flags with --help.
Output is JSON unless -f / --format.
`

const listHelp = `yaru issue list — list issues in this workspace

For my issues, use --assignee me. Use --assignee none for no assignee.
Use --parent none for issues with no parent.

Usage:
  yaru issue list [--status NAME] [--assignee NAME] [--label NAME] [--query TEXT]
                  [--due overdue] [--parent ID] [--limit N] [--cursor ID]
                  [-f|--format]

--query searches issue id, title, or body.
--due overdue is dueDate before today.
--parent filters by parent issue id.
--limit max results (default 50, max 250).
--cursor next page cursor from a previous list.
Default output is {issues, hasNextPage, cursor}. -f / --format prints a table.

Status: backlog, todo, in_progress, done, canceled
`

const getHelp = `yaru issue get — retrieve one issue by id

Usage:
  yaru issue get <id> [-f|--format]

JSON includes labels, body, parent, children, blocks, blockedBy,
startedAt, completedAt, canceledAt, createdAt, and updatedAt.
`

const saveHelp = `yaru issue save — create or update an issue

If --id is provided, updates the existing issue; otherwise creates a new one.
Do not pass --id when creating. Title is required when creating.

Omitted fields stay unchanged on update. --assignee me is git config user.name.
none clears assignee, dueDate, priority, or parent.

Repeat --label to set labels; any --label replaces the whole list. Omit to leave labels unchanged.

--block ID appends an outgoing block. --blockedBy ID records that the other issue blocks this one.
--removeBlock ID / --removeBlockedBy ID remove those relations. Repeatable.

--body is Markdown. Use --body - to read stdin. Do not escape newlines.

--patch is a JSON array of partial body edits, applied in order and atomically
(one failing operation aborts the whole save). Every anchor string must match
the current body exactly once. Only valid on update, in place of --body.
Use --patch - to read the JSON array from stdin.

Patch operations:
  replace         {"op":"replace","old_string":"...","new_string":"...","replace_all":false}
  insert_before   {"op":"insert_before","anchor":"...","text":"..."}
  insert_after    {"op":"insert_after","anchor":"...","text":"..."}
  prepend         {"op":"prepend","text":"..."}
  append          {"op":"append","text":"..."}
  replace_range   {"op":"replace_range","from":"...","to":"...","new_string":"..."}

Usage:
  yaru issue save --title TITLE [--status NAME] [--assignee NAME] [--label NAME]
                  [--dueDate YYYY-MM-DD] [--priority NAME] [--parent ID]
                  [--block ID] [--blockedBy ID] [--body TEXT|-]
                  [-f|--format]
  yaru issue save --id ID [--title TITLE] [--status NAME] [--assignee NAME] [--label NAME]
                  [--dueDate YYYY-MM-DD] [--priority NAME] [--parent ID]
                  [--block ID] [--blockedBy ID] [--removeBlock ID] [--removeBlockedBy ID]
                  [--body TEXT|-|--patch JSON|-] [-f|--format]

Status: backlog, todo, in_progress, done, canceled
Priority: urgent, high, medium, low
`

const commentHelp = `yaru comment — list, get, or save comments

  yaru comment list --issue ID
  yaru comment get <id>
  yaru comment save

Each subcommand documents its flags with --help.
Output is JSON unless -f / --format.
`

const commentListHelp = `yaru comment list — list comments on an issue

Usage:
  yaru comment list --issue ID [-f|--format]

JSON prints {comments}. Comments are ordered by createdAt.
`

const commentGetHelp = `yaru comment get — retrieve one comment by id

Usage:
  yaru comment get <id> [-f|--format]
`

const commentSaveHelp = `yaru comment save — create or update a comment

If --id is provided, updates the existing comment; otherwise creates a new one.
Do not pass --id when creating. Body is required when creating.
To start a thread, pass --issue. To reply, pass --parent; the issue is inferred.

--body is Markdown. Use --body - to read stdin. Do not escape newlines.

Usage:
  yaru comment save --issue ID --body TEXT|- [-f|--format]
  yaru comment save --parent ID --body TEXT|- [-f|--format]
  yaru comment save --id ID --body TEXT|- [-f|--format]
`

const questionHelp = `yaru question — ask the human asynchronously and read the answer

  yaru question list
  yaru question get <id>
  yaru question save
  yaru question answer <id>
  yaru question wait <id>

Ask when a decision is the human's to make. Give a defaultAction and an answerBy
so work continues with the default when no answer arrives in time.
Each subcommand documents its flags with --help.
Output is JSON unless -f / --format.
`

const questionListHelp = `yaru question list — list questions in this workspace

Usage:
  yaru question list [--status NAME] [--issue ID] [-f|--format]

Questions awaiting an answer come first: blocking ones (no default action),
then open ones by answerBy, then open ones without a deadline, then expired ones.
Answered and canceled questions follow, most recently resolved first.
JSON prints {questions}.

Status: open, expired, answered, canceled
expired is an open question whose answerBy has passed.
`

const questionGetHelp = `yaru question get — retrieve one question by id

Usage:
  yaru question get <id> [-f|--format]

Reading an answered question for the first time records acknowledgedAt,
so the human can see the answer was picked up.
`

func questionSaveHelp() string {
	// src/index.ts:210-243。publicUrl の例に DEFAULT_PORT を埋めている
	return fmt.Sprintf(`yaru question save — ask a question or update one

If --id is provided, updates the existing question; otherwise creates a new one.
Do not pass --id when creating. Title is required when creating: the question itself, one line.
Omitted fields stay unchanged on update. none clears issue, priority, default, or answerBy.

--default is the action you will take if no answer arrives by answerBy (one line).
--answerBy is a duration from now (30m, 2h, 1d) or an ISO 8601 datetime.
--option is one answer the human can pick with one tap (one line). Repeat it for each option;
any --option replaces the whole list, and --option none clears it.
--body is Markdown context: trade-offs, your recommendation. Use --body - to read stdin.
--status canceled withdraws a question that no longer needs an answer; open restores it.

Creating records the session (CLAUDE_CODE_SESSION_ID or CODEX_SESSION_ID), the git worktree,
and the branch it was asked from.
Creating refuses when an open question with the same title (and the same issue) exists;
the error names it. --force asks again anyway.
Creating without --default and --answerBy warns: the question blocks until the human answers.

Creating a question runs the notify command from .yaru/config.yml (notify: COMMAND) with
{"event":"question.created","url":"...","question":{...}} on stdin. A failing command only warns.
url opens the question on the dashboard; publicUrl: URL in config.yml replaces http://127.0.0.1:%d.
A running yaru serve also sends {"event":"question.expiring",...} once, 15 minutes before answerBy.

Usage:
  yaru question save --title TEXT [--issue ID] [--priority NAME] [--default TEXT]
                     [--answerBy WHEN] [--option TEXT]... [--body TEXT|-] [--force]
                     [-f|--format]
  yaru question save --id ID [--title TEXT] [--issue ID] [--priority NAME] [--default TEXT]
                     [--answerBy WHEN] [--option TEXT|none]... [--body TEXT|-]
                     [--status open|canceled] [-f|--format]

Priority: urgent, high, medium, low
`, server.DefaultPort)
}

const questionAnswerHelp = `yaru question answer — answer a question

Usage:
  yaru question answer <id> --body TEXT|- [--force] [-f|--format]

An expired question can still be answered; when it belongs to an issue, the late answer
is also added to the issue as a comment.
An answered question keeps its answer: answering again fails unless --force replaces it.
A canceled question cannot be answered.
`

const questionWaitHelp = `yaru question wait — block until a question is resolved

Usage:
  yaru question wait <id> [--timeout DURATION] [--interval DURATION] [-f|--format]

Returns when the question is answered, canceled, or expired (answerBy passed).
On expired, proceed with defaultAction. Prints the question as JSON.
Returning an answer records acknowledgedAt the first time.
-f / --format prints the answer, or the defaultAction when expired.

--timeout defaults to 10m, --interval to 1s. Durations: 100ms, 30s, 10m, 1h.
Exit code 0 when resolved, 2 when the timeout passed first.
`

// helpFor は src/index.ts:383-405。init と serve と未知のコマンドは全体のヘルプ
func helpFor(rest []string) string {
	if len(rest) == 0 {
		return globalHelp()
	}
	switch rest[0] {
	case "issue":
		if len(rest) > 1 {
			switch rest[1] {
			case "list":
				return listHelp
			case "get":
				return getHelp
			case "save":
				return saveHelp
			}
		}
		return issueHelp
	case "comment":
		if len(rest) > 1 {
			switch rest[1] {
			case "list":
				return commentListHelp
			case "get":
				return commentGetHelp
			case "save":
				return commentSaveHelp
			}
		}
		return commentHelp
	case "question":
		if len(rest) > 1 {
			switch rest[1] {
			case "list":
				return questionListHelp
			case "get":
				return questionGetHelp
			case "save":
				return questionSaveHelp()
			case "answer":
				return questionAnswerHelp
			case "wait":
				return questionWaitHelp
			}
		}
		return questionHelp
	default:
		return globalHelp()
	}
}
