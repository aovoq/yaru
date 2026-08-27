import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

export type Issue = {
  id: string
  title: string
  status: string
  assignee: string | null
  labels: string[]
  createdAt: string
  updatedAt: string
  body: string
}

export type Filter = {
  status?: string
  assignee?: string | null
  label?: string
  query?: string
}

export type SaveInput = {
  id?: string
  title?: string
  status?: string
  assignee?: string | null
  labels?: string[]
  body?: string
}

export type Store = {
  root: string
  dir: string
}

export const STATUSES = ["backlog", "todo", "in_progress", "done", "canceled"] as const

export function findRoot(start = process.cwd()): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, ".yaru", "config.yml"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("not a yaru workspace (run yaru init)")
    dir = parent
  }
}

export function open(root: string): Store {
  const dir = join(root, ".yaru")
  if (!existsSync(join(dir, "config.yml"))) throw new Error("not a yaru workspace (run yaru init)")
  return { root, dir }
}

export function init(root: string): Store {
  const dir = join(root, ".yaru")
  if (existsSync(join(dir, "config.yml"))) throw new Error("already a yaru workspace")
  mkdirSync(join(dir, "issues"), { recursive: true })
  writeFileSync(join(dir, "config.yml"), "")
  return { root, dir }
}

export function listIssues(store: Store, filter: Filter = {}): Issue[] {
  const dir = join(store.dir, "issues")
  if (!existsSync(dir)) return []
  const resolved: Filter = { ...filter, assignee: resolveAssignee(filter.assignee) }
  const issues: Issue[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue
    try {
      issues.push(readIssue(join(dir, name), name.slice(0, -3)))
    } catch {
      // skip hand-edited or half-written files so one bad doc cannot hide the rest
    }
  }
  issues.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
  return issues.filter((issue) => match(issue, resolved))
}

export function getIssue(store: Store, id: string): Issue {
  const path = issuePath(store, id)
  if (!existsSync(path)) throw new Error(`issue not found: ${id}`)
  return readIssue(path, id)
}

export function saveIssue(store: Store, input: SaveInput): Issue {
  const now = new Date().toISOString()
  const assignee = resolveAssignee(input.assignee)
  if (input.id) {
    const path = issuePath(store, input.id)
    if (existsSync(path)) {
      const current = readIssue(path, input.id)
      const issue: Issue = {
        ...current,
        title: input.title ?? current.title,
        status: input.status ?? current.status,
        assignee: assignee !== undefined ? assignee : current.assignee,
        labels: input.labels ?? current.labels,
        body: input.body ?? current.body,
        updatedAt: now,
      }
      writeReplace(path, issue)
      return issue
    }
    const created = newIssue(input.id, input, assignee, now)
    writeCreate(path, created)
    return created
  }
  for (;;) {
    const created = newIssue(nextId(store), input, assignee, now)
    try {
      writeCreate(issuePath(store, created.id), created)
      return created
    } catch (err) {
      if (!isEexist(err)) throw err
    }
  }
}

function newIssue(
  id: string,
  input: SaveInput,
  assignee: string | null | undefined,
  now: string,
): Issue {
  if (!input.title?.trim()) throw new Error("title is required")
  return {
    id,
    title: input.title.trim(),
    status: input.status || "todo",
    assignee: assignee ?? null,
    labels: input.labels ?? [],
    createdAt: now,
    updatedAt: now,
    body: input.body ?? "",
  }
}

function nextId(store: Store): string {
  const dir = join(store.dir, "issues")
  let max = 0
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const m = name.match(/^(\d+)\.md$/)
      if (!m) continue
      const n = Number(m[1])
      if (n > max) max = n
    }
  }
  return String(max + 1)
}

function match(issue: Issue, filter: Filter): boolean {
  if (filter.status && issue.status !== filter.status) return false
  if (filter.assignee === null && issue.assignee !== null) return false
  if (typeof filter.assignee === "string" && issue.assignee !== filter.assignee) return false
  if (filter.label && !issue.labels.includes(filter.label)) return false
  if (filter.query) {
    const q = filter.query.toLowerCase()
    const hay = `${issue.id} ${issue.title} ${issue.body}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

function resolveAssignee(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "none") return null
  if (trimmed === "me") return gitName()
  return trimmed
}

function gitName(): string {
  const out = Bun.spawnSync(["git", "config", "user.name"], { stdout: "pipe", stderr: "pipe" })
  const name = out.stdout.toString().trim()
  return name || "me"
}

function issuePath(store: Store, id: string): string {
  return join(store.dir, "issues", `${id}.md`)
}

function readIssue(path: string, stem: string): Issue {
  const issue = parseIssue(readFileSync(path, "utf8"))
  issue.id = stem
  return issue
}

function writeCreate(path: string, issue: Issue): void {
  writeFileSync(path, formatIssue(issue), { flag: "wx" })
}

function writeReplace(path: string, issue: Issue): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, formatIssue(issue))
  renameSync(tmp, path)
}

function parseIssue(text: string): Issue {
  const normalized = text.replace(/\r\n/g, "\n")
  if (!normalized.startsWith("---\n")) throw new Error("invalid issue file")
  const end = normalized.indexOf("\n---\n", 4)
  if (end < 0) throw new Error("invalid issue file")
  const raw = normalized.slice(4, end)
  const body = normalized
    .slice(end + 5)
    .replace(/^\n/, "")
    .replace(/\n$/, "")
  const meta: Record<string, string> = {}
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":")
    if (i < 0) continue
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return {
    id: meta.id || "",
    title: meta.title || "",
    status: meta.status || "todo",
    assignee: resolveAssignee(meta.assignee || "") ?? null,
    labels: (meta.labels || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    createdAt: meta.createdAt || "",
    updatedAt: meta.updatedAt || "",
    body,
  }
}

function formatIssue(issue: Issue): string {
  return `---
id: ${issue.id}
title: ${issue.title.replace(/\n/g, " ")}
status: ${issue.status}
assignee: ${issue.assignee ?? ""}
labels: ${issue.labels.join(", ")}
createdAt: ${issue.createdAt}
updatedAt: ${issue.updatedAt}
---

${issue.body}
`
}

function isEexist(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "EEXIST"
}
