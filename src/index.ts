#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import {
  findRoot,
  getComment,
  getIssue,
  init,
  listComments,
  listIssues,
  open,
  pageIssues,
  saveComment,
  saveIssue,
  type Filter,
  type SaveInput,
  type Store,
} from "./store"
import {
  acknowledgeQuestion,
  answerQuestion,
  ensureQuestionsDirectory,
  getQuestion,
  listQuestions,
  saveQuestion,
  type Question,
} from "./questions"
import { notify, notifyBaseUrl, questionUrl } from "./notify"
import { readProvenance } from "./provenance"
import { currentTime } from "./time"
import { DEFAULT_PORT, serve } from "./web"
import { registerWorkspace } from "./workspaces"

const GLOBAL_HELP = `yaru — local issues, markdown in .yaru

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
  yaru serve [-p|--port ${DEFAULT_PORT}]

Output is JSON unless -f / --format. Commands print their contract with --help.

yaru serve shows every workspace yaru has been used in: / lists them, /p/<name>/ is one board.
`

const ISSUE_HELP = `yaru issue — list, get, or save issues

  yaru issue list
  yaru issue get <id>
  yaru issue save

Each subcommand documents its flags with --help.
Output is JSON unless -f / --format.
`

const LIST_HELP = `yaru issue list — list issues in this workspace

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

const GET_HELP = `yaru issue get — retrieve one issue by id

Usage:
  yaru issue get <id> [-f|--format]

JSON includes labels, body, parent, children, blocks, blockedBy,
startedAt, completedAt, canceledAt, createdAt, and updatedAt.
`

const SAVE_HELP = `yaru issue save — create or update an issue

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

const COMMENT_HELP = `yaru comment — list, get, or save comments

  yaru comment list --issue ID
  yaru comment get <id>
  yaru comment save

Each subcommand documents its flags with --help.
Output is JSON unless -f / --format.
`

const COMMENT_LIST_HELP = `yaru comment list — list comments on an issue

Usage:
  yaru comment list --issue ID [-f|--format]

JSON prints {comments}. Comments are ordered by createdAt.
`

const COMMENT_GET_HELP = `yaru comment get — retrieve one comment by id

Usage:
  yaru comment get <id> [-f|--format]
`

const COMMENT_SAVE_HELP = `yaru comment save — create or update a comment

If --id is provided, updates the existing comment; otherwise creates a new one.
Do not pass --id when creating. Body is required when creating.
To start a thread, pass --issue. To reply, pass --parent; the issue is inferred.

--body is Markdown. Use --body - to read stdin. Do not escape newlines.

Usage:
  yaru comment save --issue ID --body TEXT|- [-f|--format]
  yaru comment save --parent ID --body TEXT|- [-f|--format]
  yaru comment save --id ID --body TEXT|- [-f|--format]
`

const QUESTION_HELP = `yaru question — ask the human asynchronously and read the answer

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

const QUESTION_LIST_HELP = `yaru question list — list questions in this workspace

Usage:
  yaru question list [--status NAME] [--issue ID] [-f|--format]

Questions awaiting an answer come first: blocking ones (no default action),
then open ones by answerBy, then open ones without a deadline, then expired ones.
Answered and canceled questions follow, most recently resolved first.
JSON prints {questions}.

Status: open, expired, answered, canceled
expired is an open question whose answerBy has passed.
`

const QUESTION_GET_HELP = `yaru question get — retrieve one question by id

Usage:
  yaru question get <id> [-f|--format]

Reading an answered question for the first time records acknowledgedAt,
so the human can see the answer was picked up.
`

const QUESTION_SAVE_HELP = `yaru question save — ask a question or update one

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
url opens the question on the dashboard; publicUrl: URL in config.yml replaces http://127.0.0.1:${DEFAULT_PORT}.
A running yaru serve also sends {"event":"question.expiring",...} once, 15 minutes before answerBy.

Usage:
  yaru question save --title TEXT [--issue ID] [--priority NAME] [--default TEXT]
                     [--answerBy WHEN] [--option TEXT]... [--body TEXT|-] [--force]
                     [-f|--format]
  yaru question save --id ID [--title TEXT] [--issue ID] [--priority NAME] [--default TEXT]
                     [--answerBy WHEN] [--option TEXT|none]... [--body TEXT|-]
                     [--status open|canceled] [-f|--format]

Priority: urgent, high, medium, low
`

const QUESTION_ANSWER_HELP = `yaru question answer — answer a question

Usage:
  yaru question answer <id> --body TEXT|- [--force] [-f|--format]

An expired question can still be answered; when it belongs to an issue, the late answer
is also added to the issue as a comment.
An answered question keeps its answer: answering again fails unless --force replaces it.
A canceled question cannot be answered.
`

const QUESTION_WAIT_HELP = `yaru question wait — block until a question is resolved

Usage:
  yaru question wait <id> [--timeout DURATION] [--interval DURATION] [-f|--format]

Returns when the question is answered, canceled, or expired (answerBy passed).
On expired, proceed with defaultAction. Prints the question as JSON.
Returning an answer records acknowledgedAt the first time.
-f / --format prints the answer, or the defaultAction when expired.

--timeout defaults to 10m, --interval to 1s. Durations: 100ms, 30s, 10m, 1h.
Exit code 0 when resolved, 2 when the timeout passed first.
`

const FORMAT_FLAGS = ["format", "f"] as const
const LIST_FLAGS = new Set([
  "help",
  "h",
  "status",
  "assignee",
  "label",
  "query",
  "due",
  "parent",
  "limit",
  "cursor",
  ...FORMAT_FLAGS,
])
const GET_FLAGS = new Set(["help", "h", "id", ...FORMAT_FLAGS])
const SAVE_FLAGS = new Set([
  "help",
  "h",
  "id",
  "title",
  "status",
  "assignee",
  "label",
  "dueDate",
  "priority",
  "parent",
  "block",
  "blockedBy",
  "removeBlock",
  "removeBlockedBy",
  "body",
  "patch",
  ...FORMAT_FLAGS,
])
const COMMENT_LIST_FLAGS = new Set(["help", "h", "issue", ...FORMAT_FLAGS])
const COMMENT_GET_FLAGS = new Set(["help", "h", "id", ...FORMAT_FLAGS])
const COMMENT_SAVE_FLAGS = new Set(["help", "h", "id", "issue", "parent", "body", ...FORMAT_FLAGS])
const QUESTION_LIST_FLAGS = new Set(["help", "h", "status", "issue", ...FORMAT_FLAGS])
const QUESTION_GET_FLAGS = new Set(["help", "h", "id", ...FORMAT_FLAGS])
const QUESTION_SAVE_FLAGS = new Set([
  "help",
  "h",
  "id",
  "title",
  "issue",
  "priority",
  "default",
  "answerBy",
  "option",
  "body",
  "status",
  "force",
  ...FORMAT_FLAGS,
])
const QUESTION_ANSWER_FLAGS = new Set(["help", "h", "id", "body", "force", ...FORMAT_FLAGS])
const QUESTION_WAIT_FLAGS = new Set(["help", "h", "id", "timeout", "interval", ...FORMAT_FLAGS])
const INIT_FLAGS = new Set(["help", "h"])
const SERVE_FLAGS = new Set(["help", "h", "port", "p"])

async function main() {
  try {
    // 読めない YARU_NOW は、ファイルを書く前に止める。値は ISO 8601 の日時 (RFC 3339)
    // https://www.rfc-editor.org/rfc/rfc3339#section-5.6
    currentTime()
    const { rest, flag, flags } = parse(process.argv.slice(2))
    const wantsHelp = Boolean(flag("help") || flag("h") || rest[0] === "help")
    if (wantsHelp) {
      process.stdout.write(helpFor(rest))
      process.exit(0)
    }
    if (rest.length === 0) {
      process.stdout.write(GLOBAL_HELP)
      process.exit(1)
    }

    const cmd = rest[0]
    if (cmd === "init") {
      assertKnownFlags(flags, INIT_FLAGS)
      const store = init(process.cwd())
      ensureQuestionsDirectory(store)
      registerWorkspace(store.root)
      console.log(`initialized ${store.dir}`)
      return
    }
    if (cmd === "serve") {
      assertKnownFlags(flags, SERVE_FLAGS)
      // yaru serve は登録された全ワークスペースを配る。起動した場所がワークスペースならそこも登録しておく
      try {
        openWorkspace()
      } catch {}
      serve(parsePort(flag("port") || flag("p")))
      return
    }
    if (cmd === "issue") {
      await issue(rest.slice(1), flag, flags)
      return
    }
    if (cmd === "comment") {
      await comment(rest.slice(1), flag, flags)
      return
    }
    if (cmd === "question") {
      await question(rest.slice(1), flag, flags)
      return
    }
    throw new Error(`unknown command: ${cmd}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    process.exit(1)
  }
}

function helpFor(rest: string[]): string {
  if (rest[0] === "issue") {
    if (rest[1] === "list") return LIST_HELP
    if (rest[1] === "get") return GET_HELP
    if (rest[1] === "save") return SAVE_HELP
    return ISSUE_HELP
  }
  if (rest[0] === "comment") {
    if (rest[1] === "list") return COMMENT_LIST_HELP
    if (rest[1] === "get") return COMMENT_GET_HELP
    if (rest[1] === "save") return COMMENT_SAVE_HELP
    return COMMENT_HELP
  }
  if (rest[0] === "question") {
    if (rest[1] === "list") return QUESTION_LIST_HELP
    if (rest[1] === "get") return QUESTION_GET_HELP
    if (rest[1] === "save") return QUESTION_SAVE_HELP
    if (rest[1] === "answer") return QUESTION_ANSWER_HELP
    if (rest[1] === "wait") return QUESTION_WAIT_HELP
    return QUESTION_HELP
  }
  return GLOBAL_HELP
}

async function issue(
  rest: string[],
  flag: (k: string) => string | undefined,
  flags: Record<string, string[]>,
) {
  const sub = rest[0]
  if (sub === "list") {
    assertKnownFlags(flags, LIST_FLAGS)
    assertNoExtra(rest.slice(1))
    const store = openWorkspace()
    const filter: Filter = {}
    if (flag("status")) filter.status = flag("status")
    if (flag("query")) filter.query = flag("query")
    if (flag("label")) filter.label = flag("label")
    if (flag("assignee") !== undefined) filter.assignee = flag("assignee")
    if (flag("parent") !== undefined) {
      filter.parent = flag("parent") === "none" ? null : flag("parent")
    }
    if (flag("due") !== undefined) {
      if (flag("due") !== "overdue") {
        throw new Error(`invalid due: expected overdue, actual ${flag("due")}`)
      }
      filter.due = "overdue"
    }
    const page = pageIssues(listIssues(store, filter), {
      limit: parseLimitFlag(flag("limit")),
      cursor: flag("cursor"),
    })
    if (outputFormat(flag) === "json") {
      printJson(page)
      return
    }
    if (page.issues.length === 0) {
      console.log("(none)")
      return
    }
    const width = Math.max(...page.issues.map((row) => row.id.length))
    for (const row of page.issues) {
      const who = row.assignee ?? "-"
      const due = row.dueDate ?? "-"
      const priority = row.priority ?? "-"
      console.log(
        `${row.id.padEnd(width)}  ${row.status.padEnd(12)}  ${who.padEnd(12)}  ${due.padEnd(10)}  ${priority.padEnd(6)}  ${row.title}`,
      )
    }
    return
  }
  if (sub === "get") {
    assertKnownFlags(flags, GET_FLAGS)
    const id = flag("id") || rest[1]
    if (!id) throw new Error("usage: yaru issue get <id>")
    assertNoExtra(rest.slice(flag("id") ? 1 : 2))
    const found = getIssue(openWorkspace(), id)
    if (outputFormat(flag) === "json") printJson(found)
    else process.stdout.write(formatGet(found))
    return
  }
  if (sub === "save") {
    assertKnownFlags(flags, SAVE_FLAGS)
    assertNoExtra(rest.slice(1))
    const input: SaveInput = {}
    if (flag("id")) input.id = flag("id")
    if (flag("title") !== undefined) input.title = flag("title")
    if (flag("status") !== undefined) input.status = flag("status")
    if (flag("body") !== undefined && flag("patch") !== undefined) {
      throw new Error("cannot pass body and patch together")
    }
    if (flag("body") === "-") input.body = readStdin()
    else if (flag("body") !== undefined) input.body = flag("body")
    if (flag("patch") !== undefined) input.patch = parsePatchJson(flag("patch")!)
    if (flags.label) input.labels = flags.label
    if (flag("assignee") !== undefined) input.assignee = flag("assignee")
    if (flag("dueDate") !== undefined) input.dueDate = flag("dueDate")
    if (flag("priority") !== undefined) input.priority = flag("priority")
    if (flag("parent") !== undefined) input.parent = flag("parent")
    if (flags.block) input.addBlocks = flags.block
    if (flags.blockedBy) input.addBlockedBy = flags.blockedBy
    if (flags.removeBlock) input.removeBlocks = flags.removeBlock
    if (flags.removeBlockedBy) input.removeBlockedBy = flags.removeBlockedBy
    // 作業場所は CLI を動かした場所から読む。store.root は worktree の中でも元のフォルダを指すため
    const saved = saveIssue(openWorkspace(), input, { provenance: readProvenance(process.cwd()) })
    if (outputFormat(flag) === "json") {
      printJson(saved)
      return
    }
    console.log(saved.id)
    await hintBoard(saved.id)
    return
  }
  throw new Error("usage: yaru issue list|get|save")
}

async function comment(
  rest: string[],
  flag: (k: string) => string | undefined,
  flags: Record<string, string[]>,
) {
  const sub = rest[0]
  if (sub === "list") {
    assertKnownFlags(flags, COMMENT_LIST_FLAGS)
    assertNoExtra(rest.slice(1))
    const issue = flag("issue")
    if (!issue) throw new Error("usage: yaru comment list --issue ID")
    const comments = listComments(openWorkspace(), { issue })
    if (outputFormat(flag) === "json") {
      printJson({ comments })
      return
    }
    if (comments.length === 0) {
      console.log("(none)")
      return
    }
    for (const row of comments) {
      console.log(`${row.id}  ${row.author}  ${row.body.split("\n")[0]}`)
    }
    return
  }
  if (sub === "get") {
    assertKnownFlags(flags, COMMENT_GET_FLAGS)
    const id = flag("id") || rest[1]
    if (!id) throw new Error("usage: yaru comment get <id>")
    assertNoExtra(rest.slice(flag("id") ? 1 : 2))
    const found = getComment(openWorkspace(), id)
    if (outputFormat(flag) === "json") printJson(found)
    else process.stdout.write(formatComment(found))
    return
  }
  if (sub === "save") {
    assertKnownFlags(flags, COMMENT_SAVE_FLAGS)
    assertNoExtra(rest.slice(1))
    const body = flag("body") === "-" ? readStdin() : flag("body")
    const saved = saveComment(openWorkspace(), {
      id: flag("id"),
      issue: flag("issue"),
      parent: flag("parent"),
      body,
    })
    if (outputFormat(flag) === "json") {
      printJson(saved)
      return
    }
    console.log(saved.id)
    return
  }
  throw new Error("usage: yaru comment list|get|save")
}

async function question(
  rest: string[],
  flag: (k: string) => string | undefined,
  flags: Record<string, string[]>,
) {
  const sub = rest[0]
  if (sub === "list") {
    assertKnownFlags(flags, QUESTION_LIST_FLAGS)
    assertNoExtra(rest.slice(1))
    const questions = listQuestions(openWorkspace(), {
      status: flag("status"),
      issue: flag("issue"),
    })
    if (outputFormat(flag) === "json") {
      printJson({ questions })
      return
    }
    if (questions.length === 0) {
      console.log("(none)")
      return
    }
    const width = Math.max(...questions.map((row) => row.id.length))
    for (const row of questions) {
      console.log(
        `${row.id.padEnd(width)}  ${row.status.padEnd(8)}  ${(row.priority ?? "-").padEnd(6)}  ${(row.answerBy ?? "-").padEnd(24)}  ${row.title}`,
      )
    }
    return
  }
  if (sub === "get") {
    assertKnownFlags(flags, QUESTION_GET_FLAGS)
    const id = flag("id") || rest[1]
    if (!id) throw new Error("usage: yaru question get <id>")
    assertNoExtra(rest.slice(flag("id") ? 1 : 2))
    const found = acknowledgeQuestion(openWorkspace(), id)
    if (outputFormat(flag) === "json") printJson(found)
    else process.stdout.write(formatQuestion(found))
    return
  }
  if (sub === "save") {
    assertKnownFlags(flags, QUESTION_SAVE_FLAGS)
    assertNoExtra(rest.slice(1))
    const store = openWorkspace()
    const creating = !flag("id")
    const saved = saveQuestion(store, {
      id: flag("id"),
      title: flag("title"),
      issue: flag("issue"),
      priority: flag("priority"),
      defaultAction: flag("default"),
      answerBy: flag("answerBy"),
      options: parseOptionFlags(flags.option),
      status: flag("status"),
      body: flag("body") === "-" ? readStdin() : flag("body"),
      // 作業場所は CLI を動かした場所から読む。store.root は worktree の中でも元のフォルダを指すため
      provenance: creating ? readProvenance(process.cwd()) : undefined,
      force: flag("force") === "true",
    })
    if (creating) {
      if (saved.defaultAction === null && saved.answerBy === null) {
        console.error(
          `warning: question ${saved.id} has no --default and no --answerBy: work blocks until the human answers; give both unless there is no safe default`,
        )
      }
      const workspace = registerWorkspace(store.root)
      const warning = notify(store, {
        event: "question.created",
        url: questionUrl(
          notifyBaseUrl(store, `http://127.0.0.1:${DEFAULT_PORT}`),
          workspace.slug,
          saved.id,
        ),
        question: saved,
      })
      if (warning) console.error(warning)
    }
    if (outputFormat(flag) === "json") {
      printJson(saved)
      return
    }
    console.log(saved.id)
    return
  }
  if (sub === "answer") {
    assertKnownFlags(flags, QUESTION_ANSWER_FLAGS)
    const id = flag("id") || rest[1]
    if (!id) throw new Error("usage: yaru question answer <id> --body TEXT|-")
    assertNoExtra(rest.slice(flag("id") ? 1 : 2))
    const body = flag("body") === "-" ? readStdin() : flag("body")
    const saved = answerQuestion(openWorkspace(), id, { body, force: flag("force") === "true" })
    if (outputFormat(flag) === "json") {
      printJson(saved)
      return
    }
    console.log(saved.id)
    return
  }
  if (sub === "wait") {
    assertKnownFlags(flags, QUESTION_WAIT_FLAGS)
    const id = flag("id") || rest[1]
    if (!id) throw new Error("usage: yaru question wait <id>")
    assertNoExtra(rest.slice(flag("id") ? 1 : 2))
    const timeout = parseDurationFlag("timeout", flag("timeout") ?? "10m")
    const interval = parseDurationFlag("interval", flag("interval") ?? "1s")
    const store = openWorkspace()
    // 待ち時間は単調に進む時計で測る。YARU_NOW で止めた現在時刻だと timeout が来ない
    // https://www.w3.org/TR/hr-time-3/#dom-performance-now
    const waitStartedAt = performance.now()
    const waitDeadline = waitStartedAt + timeout
    let current = getQuestion(store, id)
    while (current.status === "open" && performance.now() < waitDeadline) {
      const remainingMilliseconds = waitDeadline - performance.now()
      await Bun.sleep(Math.min(interval, Math.max(remainingMilliseconds, 0)))
      current = getQuestion(store, id)
    }
    current = acknowledgeQuestion(store, id)
    if (outputFormat(flag) === "json") printJson(current)
    else process.stdout.write(formatWaitResult(current))
    if (current.status === "open") {
      console.error(`timed out after ${flag("timeout") ?? "10m"} waiting for question ${id}`)
      process.exit(2)
    }
    return
  }
  throw new Error("usage: yaru question list|get|save|answer|wait")
}

function formatQuestion(question: Question): string {
  const lines = [
    `${question.id}  ${question.status}  ${question.priority ?? "-"}  issue ${question.issue ?? "-"}  answerBy ${question.answerBy ?? "-"}`,
    question.title,
  ]
  if (question.defaultAction) lines.push(`default: ${question.defaultAction}`)
  for (const option of question.options) lines.push(`option: ${option}`)
  if (question.branch || question.worktree || question.session) {
    lines.push(
      `asked from: ${question.branch ?? "-"}  ${question.worktree ?? "-"}  session ${question.session ?? "-"}`,
    )
  }
  if (question.body) lines.push("", question.body)
  if (question.answer !== null) {
    lines.push(
      "",
      `answer (${question.answeredBy ?? "-"} ${question.answeredAt ?? "-"}, picked up ${question.acknowledgedAt ?? "-"}):`,
      question.answer,
    )
  }
  return `${lines.join("\n")}\n`
}

function formatWaitResult(question: Question): string {
  if (question.status === "answered") return `answered\n${question.answer}\n`
  if (question.status === "expired") {
    return `expired: proceed with the default action\n${question.defaultAction ?? "(no default action)"}\n`
  }
  return `${question.status}\n`
}

// --option を並べた順に選択肢にする。none だけなら選択肢を消す
function parseOptionFlags(values: string[] | undefined): string[] | null | undefined {
  if (values === undefined) return undefined
  if (values.length === 1 && values[0] === "none") return null
  return values
}

const DURATION_MILLISECONDS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }

function parseDurationFlag(name: string, raw: string): number {
  const match = raw.match(/^(\d+)(ms|s|m|h)$/)
  if (!match) {
    throw new Error(
      `invalid ${name}: expected a duration like 100ms, 30s, 10m, or 1h, actual ${raw}`,
    )
  }
  return Number(match[1]) * DURATION_MILLISECONDS[match[2]!]!
}

// CLI がワークスペースを開くたびに登録し、1 つの yaru serve から全ワークスペースを見られるようにする
function openWorkspace(): Store {
  const store = open(findRoot())
  registerWorkspace(store.root)
  return store
}

async function hintBoard(id: string) {
  try {
    const workspace = registerWorkspace(findRoot())
    const base = `http://127.0.0.1:${DEFAULT_PORT}/p/${encodeURIComponent(workspace.slug)}`
    const res = await fetch(`${base}/api/issues/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(200),
    })
    if (res.ok) console.log(`${base}/?id=${encodeURIComponent(id)}`)
  } catch {
    // board is optional; save already succeeded
  }
}

function formatGet(issue: ReturnType<typeof getIssue>): string {
  const labels = issue.labels.join(", ") || "-"
  const blocks = issue.blocks.join(", ") || "-"
  const blockedBy = issue.blockedBy.join(", ") || "-"
  return `${issue.id}  ${issue.status}  ${issue.assignee ?? "-"}  ${labels}  ${issue.dueDate ?? "-"}  ${issue.priority ?? "-"}  parent ${issue.parent ?? "-"}  blocks ${blocks}  blockedBy ${blockedBy}
${issue.title}

${issue.body}${issue.body ? "\n" : ""}`
}

function formatComment(comment: ReturnType<typeof getComment>): string {
  return `${comment.id}  ${comment.issue}  ${comment.parent ?? "-"}  ${comment.author}
${comment.body}${comment.body ? "\n" : ""}`
}

function outputFormat(flag: (k: string) => string | undefined): "json" | "human" {
  return flag("format") || flag("f") ? "human" : "json"
}

function parsePatchJson(raw: string): unknown {
  const text = raw === "-" ? readStdin() : raw
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `invalid patch: expected a JSON array of operations, actual ${JSON.stringify(text)}`,
    )
  }
}

function parseLimitFlag(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`invalid limit: expected an integer from 1 to 250, actual ${raw}`)
  }
  return Number(raw)
}

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function readStdin(): string {
  return readFileSync(0, "utf8")
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${raw}`)
  return port
}

function assertKnownFlags(flags: Record<string, string[]>, allowed: Set<string>) {
  for (const key of Object.keys(flags)) {
    if (allowed.has(key)) continue
    throw new Error(`unknown flag: ${key.length === 1 ? `-${key}` : `--${key}`}`)
  }
}

function assertNoExtra(rest: string[]) {
  if (rest.length > 0) throw new Error(`unexpected argument: ${rest[0]}`)
}

const BARE = new Set(["help", "h", "format", "f", "force"])

function parse(argv: string[]) {
  const rest: string[] = []
  const flags: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--") {
      rest.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith("--") || /^-[a-zA-Z]$/.test(a)) {
      const key = a.replace(/^--?/, "")
      if (BARE.has(key)) {
        flags[key] = [...(flags[key] ?? []), "true"]
        continue
      }
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--") || /^-[a-zA-Z]$/.test(next)) {
        throw new Error(`missing value for ${a}`)
      }
      flags[key] = [...(flags[key] ?? []), next]
      i++
    } else rest.push(a)
  }
  return {
    rest,
    flags,
    flag: (k: string) => flags[k]?.[0],
  }
}

await main()
