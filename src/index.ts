#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import {
  findRoot,
  getIssue,
  init,
  listIssues,
  open,
  pageIssues,
  saveIssue,
  type Filter,
  type SaveInput,
} from "./store"
import { DEFAULT_PORT, serve } from "./web"

const GLOBAL_HELP = `yaru — local issues, markdown in .yaru

  yaru init
  yaru issue list
  yaru issue get <id>
  yaru issue save
  yaru serve [-p|--port ${DEFAULT_PORT}]

Issue commands print their contract with --help, e.g. yaru issue save --help.
`

const ISSUE_HELP = `yaru issue — list, get, or save issues

  yaru issue list
  yaru issue get <id>
  yaru issue save

Each subcommand documents its flags with --help.
`

const LIST_HELP = `yaru issue list — list issues in this workspace

For my issues, use --assignee me. Use --assignee none for no assignee.

Usage:
  yaru issue list [--status NAME] [--assignee NAME] [--label NAME] [--query TEXT]
                  [--due overdue] [--limit N] [--cursor ID] [--json]

--query searches issue id, title, or body.
--due overdue is dueDate before today.
--limit max results (default 50, max 250).
--cursor next page cursor from a previous --json list.
--json prints {issues, hasNextPage, cursor} instead of a table.

Status: backlog, todo, in_progress, done, canceled
`

const GET_HELP = `yaru issue get — retrieve one issue by id

Usage:
  yaru issue get <id> [--json]

--json prints the issue object, including labels, body, createdAt, and updatedAt.
`

const SAVE_HELP = `yaru issue save — create or update an issue

If --id is provided, updates the existing issue; otherwise creates a new one.
Do not pass --id when creating. Title is required when creating.

Omitted fields stay unchanged on update. --assignee me is git config user.name.
none clears assignee, dueDate, or priority.

Repeat --label to set labels; any --label replaces the whole list. Omit to leave labels unchanged.

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
                  [--dueDate YYYY-MM-DD] [--priority NAME] [--body TEXT|-] [--json]
  yaru issue save --id ID [--title TITLE] [--status NAME] [--assignee NAME] [--label NAME]
                  [--dueDate YYYY-MM-DD] [--priority NAME] [--body TEXT|-|--patch JSON|-] [--json]

Status: backlog, todo, in_progress, done, canceled
Priority: urgent, high, medium, low
`

const LIST_FLAGS = new Set([
  "help",
  "h",
  "status",
  "assignee",
  "label",
  "query",
  "due",
  "limit",
  "cursor",
  "json",
])
const GET_FLAGS = new Set(["help", "h", "id", "json"])
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
  "body",
  "patch",
  "json",
])
const INIT_FLAGS = new Set(["help", "h"])
const SERVE_FLAGS = new Set(["help", "h", "port", "p"])

async function main() {
  try {
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
      console.log(`initialized ${store.dir}`)
      return
    }
    if (cmd === "serve") {
      assertKnownFlags(flags, SERVE_FLAGS)
      serve(open(findRoot()), parsePort(flag("port") || flag("p")))
      return
    }
    if (cmd === "issue") {
      await issue(rest.slice(1), flag, flags)
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
    const store = open(findRoot())
    const filter: Filter = {}
    if (flag("status")) filter.status = flag("status")
    if (flag("query")) filter.query = flag("query")
    if (flag("label")) filter.label = flag("label")
    if (flag("assignee") !== undefined) filter.assignee = flag("assignee")
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
    if (flag("json")) {
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
    const found = getIssue(open(findRoot()), id)
    if (flag("json")) printJson(found)
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
    const saved = saveIssue(open(findRoot()), input)
    if (flag("json")) {
      printJson(saved)
      return
    }
    console.log(saved.id)
    await hintBoard(saved.id)
    return
  }
  throw new Error("usage: yaru issue list|get|save")
}

async function hintBoard(id: string) {
  try {
    const base = `http://127.0.0.1:${DEFAULT_PORT}`
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
  return `${issue.id}  ${issue.status}  ${issue.assignee ?? "-"}  ${labels}  ${issue.dueDate ?? "-"}  ${issue.priority ?? "-"}
${issue.title}

${issue.body}${issue.body ? "\n" : ""}`
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

const BARE = new Set(["help", "h", "json"])

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
