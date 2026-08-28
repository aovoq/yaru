import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const
export type Priority = (typeof PRIORITIES)[number]

export type Issue = {
  id: string
  title: string
  status: string
  assignee: string | null
  labels: string[]
  dueDate: string | null
  priority: Priority | null
  createdAt: string
  updatedAt: string
  body: string
}

export type Filter = {
  status?: string
  assignee?: string | null
  label?: string
  query?: string
  due?: "overdue"
}

export type PatchOp =
  | { op: "replace"; old_string: string; new_string: string; replace_all?: boolean }
  | { op: "insert_before"; anchor: string; text: string }
  | { op: "insert_after"; anchor: string; text: string }
  | { op: "prepend"; text: string }
  | { op: "append"; text: string }
  | { op: "replace_range"; from: string; to: string; new_string: string }

export type SaveInput = {
  id?: string
  title?: string
  status?: string
  assignee?: string | null
  labels?: string[]
  dueDate?: string | null
  priority?: string | null
  body?: string
  patch?: unknown
}

export const LIST_LIMIT_DEFAULT = 50
export const LIST_LIMIT_MAX = 250

export type IssuePage = {
  issues: Issue[]
  hasNextPage: boolean
  cursor?: string
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
  if (resolved.status !== undefined) resolved.status = resolveStatus(resolved.status)
  const issues: Issue[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue
    try {
      issues.push(readIssue(join(dir, name), name.slice(0, -3)))
    } catch {
      // 壊れた手編集ファイルが一覧全体を隠さないようにする
    }
  }
  issues.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
  return issues.filter((issue) => match(issue, resolved))
}

export function pageIssues(
  issues: Issue[],
  options: { limit?: number; cursor?: string } = {},
): IssuePage {
  const limit = resolveLimit(options.limit)
  let start = 0
  if (options.cursor !== undefined) {
    const index = issues.findIndex((issue) => issue.id === options.cursor)
    if (index < 0) {
      throw new Error(
        `cursor not found: expected an issue id from a previous list page, actual ${options.cursor}`,
      )
    }
    start = index + 1
  }
  const page = issues.slice(start, start + limit)
  const hasNextPage = start + limit < issues.length
  if (hasNextPage && page.length > 0) {
    return { issues: page, hasNextPage, cursor: page[page.length - 1]!.id }
  }
  return { issues: page, hasNextPage }
}

export function getIssue(store: Store, id: string): Issue {
  const path = issuePath(store, id)
  if (!existsSync(path)) throw new Error(`issue not found: ${id}`)
  return readIssue(path, id)
}

export function saveIssue(store: Store, input: SaveInput): Issue {
  const now = new Date().toISOString()
  const assignee = resolveAssignee(input.assignee)
  const dueDate = resolveDueDate(input.dueDate)
  const priority = resolvePriority(input.priority)
  const status = input.status !== undefined ? resolveStatus(input.status) : undefined
  const patch = input.patch !== undefined ? parsePatch(input.patch) : undefined
  if (patch && input.body !== undefined) throw new Error("cannot pass body and patch together")
  if (patch && !input.id) throw new Error("patch is only valid when updating an existing issue")
  if (input.id) {
    const path = issuePath(store, input.id)
    if (!existsSync(path)) throw new Error(`issue not found: ${input.id}`)
    const current = readIssue(path, input.id)
    if (input.title !== undefined && !input.title.trim()) {
      throw new Error(`invalid title: expected a non-empty string, actual ${JSON.stringify(input.title)}`)
    }
    const issue: Issue = {
      ...current,
      title: input.title !== undefined ? input.title.trim() : current.title,
      status: status ?? current.status,
      assignee: assignee !== undefined ? assignee : current.assignee,
      labels: input.labels ?? current.labels,
      dueDate: dueDate !== undefined ? dueDate : current.dueDate,
      priority: priority !== undefined ? priority : current.priority,
      body: patch ? applyPatch(current.body, patch) : (input.body ?? current.body),
      updatedAt: now,
    }
    writeReplace(path, issue)
    return issue
  }
  for (;;) {
    const created = newIssue(nextId(store), input, { assignee, dueDate, priority, status }, now)
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
  resolved: {
    assignee: string | null | undefined
    dueDate: string | null | undefined
    priority: Priority | null | undefined
    status: string | undefined
  },
  now: string,
): Issue {
  if (!input.title?.trim()) throw new Error("title is required when creating an issue")
  return {
    id,
    title: input.title.trim(),
    status: resolved.status ?? "todo",
    assignee: resolved.assignee ?? null,
    labels: input.labels ?? [],
    dueDate: resolved.dueDate ?? null,
    priority: resolved.priority ?? null,
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
  if (filter.due === "overdue" && !isOverdue(issue.dueDate)) return false
  return true
}

export function isOverdue(dueDate: string | null, now = new Date()): boolean {
  return dueDate !== null && dueDate < calendarDate(now)
}

function calendarDate(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "none") return null
  return trimmed
}

function resolveAssignee(value: string | null | undefined): string | null | undefined {
  const resolved = blankToNull(value)
  if (resolved === "me") return gitName()
  return resolved
}

function resolveDueDate(value: string | null | undefined): string | null | undefined {
  const resolved = blankToNull(value)
  if (resolved === undefined || resolved === null) return resolved
  if (!isCalendarDate(resolved)) {
    throw new Error(`invalid dueDate: expected YYYY-MM-DD, actual ${value}`)
  }
  return resolved
}

function resolvePriority(value: string | null | undefined): Priority | null | undefined {
  const resolved = blankToNull(value)
  if (resolved === undefined || resolved === null) return resolved
  if (!(PRIORITIES as readonly string[]).includes(resolved)) {
    throw new Error(`invalid priority: expected ${joinOr(PRIORITIES)}, actual ${value}`)
  }
  return resolved as Priority
}

function resolveStatus(value: string): string {
  const trimmed = value.trim()
  if (!(STATUSES as readonly string[]).includes(trimmed)) {
    throw new Error(`invalid status: expected ${joinOr(STATUSES)}, actual ${value}`)
  }
  return trimmed
}

export function resolveLimit(value: number | undefined): number {
  const limit = value ?? LIST_LIMIT_DEFAULT
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) {
    throw new Error(
      `invalid limit: expected an integer from 1 to ${LIST_LIMIT_MAX}, actual ${value ?? limit}`,
    )
  }
  return limit
}

function joinOr(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" or ")
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const y = Number(value.slice(0, 4))
  const m = Number(value.slice(5, 7))
  const d = Number(value.slice(8, 10))
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
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
    status: resolveStatus(meta.status || "todo"),
    assignee: resolveAssignee(meta.assignee || "") ?? null,
    labels: (meta.labels || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dueDate: resolveDueDate(meta.dueDate ?? "") ?? null,
    priority: resolvePriority(meta.priority ?? "") ?? null,
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
dueDate: ${issue.dueDate ?? ""}
priority: ${issue.priority ?? ""}
createdAt: ${issue.createdAt}
updatedAt: ${issue.updatedAt}
---

${issue.body}
`
}

const PATCH_OPS = [
  "replace",
  "insert_before",
  "insert_after",
  "prepend",
  "append",
  "replace_range",
] as const

export function parsePatch(value: unknown): PatchOp[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `invalid patch: expected a JSON array of operations, actual ${actualValue(value)}`,
    )
  }
  if (value.length < 1 || value.length > 50) {
    throw new Error(`invalid patch: expected 1 to 50 operations, actual ${value.length}`)
  }
  return value.map((item) => parsePatchOp(item))
}

function parsePatchOp(value: unknown): PatchOp {
  if (!isPlainObject(value)) {
    throw new Error(`invalid patch: expected an operation object, actual ${actualValue(value)}`)
  }
  const op = value.op
  if (typeof op !== "string") {
    throw new Error(`invalid patch: op is required`)
  }
  if (op === "replace") {
    return {
      op,
      old_string: requiredText(value, "old_string", "replace", 1),
      new_string: requiredText(value, "new_string", "replace", 0),
      ...(value.replace_all !== undefined
        ? { replace_all: requiredBoolean(value, "replace_all", "replace") }
        : {}),
    }
  }
  if (op === "insert_before" || op === "insert_after") {
    return {
      op,
      anchor: requiredText(value, "anchor", op, 1),
      text: requiredText(value, "text", op, 1),
    }
  }
  if (op === "prepend" || op === "append") {
    return { op, text: requiredText(value, "text", op, 1) }
  }
  if (op === "replace_range") {
    return {
      op,
      from: requiredText(value, "from", "replace_range", 1),
      to: requiredText(value, "to", "replace_range", 1),
      new_string: requiredText(value, "new_string", "replace_range", 0),
    }
  }
  throw new Error(`invalid patch: expected op ${joinOr(PATCH_OPS)}, actual ${op}`)
}

function applyPatch(body: string, ops: PatchOp[]): string {
  let content = body
  for (const op of ops) content = applyPatchOp(content, op)
  return content
}

function applyPatchOp(content: string, op: PatchOp): string {
  if (op.op === "replace") {
    const count = matchCount(content, op.old_string)
    if (op.replace_all) {
      if (count < 1) {
        throw new Error(
          `patch replace: old_string must match the current body at least once, expected 1 or more matches, actual ${count}`,
        )
      }
      return content.split(op.old_string).join(op.new_string)
    }
    requireUnique(count, "replace", "old_string")
    const index = content.indexOf(op.old_string)
    return content.slice(0, index) + op.new_string + content.slice(index + op.old_string.length)
  }
  if (op.op === "insert_before" || op.op === "insert_after") {
    requireUnique(matchCount(content, op.anchor), op.op, "anchor")
    const index = content.indexOf(op.anchor)
    if (op.op === "insert_before") return content.slice(0, index) + op.text + content.slice(index)
    const end = index + op.anchor.length
    return content.slice(0, end) + op.text + content.slice(end)
  }
  if (op.op === "prepend") return op.text + content
  if (op.op === "append") return content + op.text
  requireUnique(matchCount(content, op.from), "replace_range", "from")
  const fromIndex = content.indexOf(op.from)
  const afterFrom = fromIndex + op.from.length
  const rest = content.slice(afterFrom)
  const toCount = matchCount(rest, op.to)
  if (toCount !== 1) {
    throw new Error(
      `patch replace_range: to must match the current body exactly once after from, expected 1 match, actual ${toCount}`,
    )
  }
  const toIndex = afterFrom + rest.indexOf(op.to)
  return content.slice(0, fromIndex) + op.new_string + content.slice(toIndex)
}

function requireUnique(count: number, op: string, field: string): void {
  if (count !== 1) {
    throw new Error(
      `patch ${op}: ${field} must match the current body exactly once, expected 1 match, actual ${count}`,
    )
  }
}

function matchCount(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from)
    if (index < 0) return count
    count++
    from = index + needle.length
  }
  return count
}

function requiredText(
  value: Record<string, unknown>,
  key: string,
  op: string,
  minLength: number,
): string {
  const field = value[key]
  if (typeof field !== "string" || field.length < minLength) {
    throw new Error(
      `invalid patch ${op}: ${key} must be a ${minLength > 0 ? "non-empty string" : "string"}, actual ${actualValue(field)}`,
    )
  }
  return field
}

function requiredBoolean(value: Record<string, unknown>, key: string, op: string): boolean {
  const field = value[key]
  if (typeof field !== "boolean") {
    throw new Error(`invalid patch ${op}: ${key} must be a boolean, actual ${actualValue(field)}`)
  }
  return field
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function actualValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (typeof value === "object") return "object"
  return String(value)
}

function isEexist(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "EEXIST"
}
