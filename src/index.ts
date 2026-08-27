#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import {
  findRoot,
  getIssue,
  init,
  listIssues,
  open,
  saveIssue,
  type Filter,
  type SaveInput,
} from "./store"
import { DEFAULT_PORT, serve } from "./web"

const HELP = `yaru — local issues, markdown in .yaru

  bun yaru init
  bun yaru issue list [--status NAME] [--assignee NAME] [--label NAME] [--query TEXT] [--due overdue]
  bun yaru issue get <id>
  bun yaru issue save --title TITLE [--id ID] [--status NAME] [--assignee NAME] [--label NAME] [--dueDate DATE] [--priority NAME] [--body TEXT|-]
  bun yaru serve [-p|--port ${DEFAULT_PORT}]
`

async function main() {
  try {
    const { rest, flag, flags } = parse(process.argv.slice(2))
    const wantsHelp = Boolean(flag("help") || flag("h") || rest[0] === "help")
    if (wantsHelp || rest.length === 0) {
      process.stdout.write(HELP)
      process.exit(wantsHelp ? 0 : 1)
    }

    const cmd = rest[0]
    if (cmd === "init") {
      const store = init(process.cwd())
      console.log(`initialized ${store.dir}`)
      return
    }
    if (cmd === "serve") {
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

async function issue(
  rest: string[],
  flag: (k: string) => string | undefined,
  flags: Record<string, string[]>,
) {
  const store = open(findRoot())
  const sub = rest[0]
  if (sub === "list") {
    const filter: Filter = {}
    if (flag("status")) filter.status = flag("status")
    if (flag("query")) filter.query = flag("query")
    if (flag("label")) filter.label = flag("label")
    if (flag("assignee") !== undefined) filter.assignee = flag("assignee")
    if (flag("due") !== undefined) {
      if (flag("due") !== "overdue") throw new Error("usage: --due overdue")
      filter.due = "overdue"
    }
    const rows = listIssues(store, filter)
    if (rows.length === 0) {
      console.log("(none)")
      return
    }
    const width = Math.max(...rows.map((r) => r.id.length))
    for (const row of rows) {
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
    const id = flag("id") || rest[1]
    if (!id) throw new Error("usage: yaru issue get <id>")
    const found = getIssue(store, id)
    process.stdout.write(formatGet(found))
    return
  }
  if (sub === "save") {
    const input: SaveInput = {}
    if (flag("id") || rest[1]) input.id = flag("id") || rest[1]
    if (flag("title") !== undefined) input.title = flag("title")
    if (flag("status") !== undefined) input.status = flag("status")
    if (flag("body") === "-") input.body = readStdin()
    else if (flag("body") !== undefined) input.body = flag("body")
    if (flags.label) input.labels = flags.label
    if (flag("assignee") !== undefined) input.assignee = flag("assignee")
    if (flag("dueDate") !== undefined) input.dueDate = flag("dueDate")
    if (flag("priority") !== undefined) input.priority = flag("priority")
    const saved = saveIssue(store, input)
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

function readStdin(): string {
  return readFileSync(0, "utf8")
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${raw}`)
  return port
}

const BARE = new Set(["help", "h"])

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
