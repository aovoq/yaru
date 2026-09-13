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
  parent: string | null
  blocks: string[]
  blockedBy: string[]
  children: string[]
  startedAt: string | null
  completedAt: string | null
  canceledAt: string | null
  createdAt: string
  updatedAt: string
  body: string
}

export type Comment = {
  id: string
  issue: string
  parent: string | null
  author: string
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
  parent?: string | null
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
  parent?: string | null
  blocks?: string[]
  addBlocks?: string[]
  removeBlocks?: string[]
  addBlockedBy?: string[]
  removeBlockedBy?: string[]
  body?: string
  patch?: unknown
}

export type SaveCommentInput = {
  id?: string
  issue?: string
  parent?: string | null
  body?: string
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
  mkdirSync(join(dir, "comments"), { recursive: true })
  writeFileSync(join(dir, "config.yml"), "")
  return { root, dir }
}

function loadRawIssues(store: Store): Issue[] {
  const dir = join(store.dir, "issues")
  if (!existsSync(dir)) return []
  const issues: Issue[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue
    try {
      issues.push(readIssue(join(dir, name), name.slice(0, -3)))
    } catch {
      // 壊れた手編集ファイルが一覧全体を隠さないようにする
    }
  }
  return issues
}

function withRelations(issues: Issue[]): Issue[] {
  return issues.map((issue) => ({
    ...issue,
    blockedBy: issues.filter((other) => other.blocks.includes(issue.id)).map((other) => other.id),
    children: issues.filter((other) => other.parent === issue.id).map((other) => other.id),
  }))
}

export function listIssues(store: Store, filter: Filter = {}): Issue[] {
  const resolved: Filter = { ...filter, assignee: resolveAssignee(filter.assignee) }
  if (resolved.status !== undefined) resolved.status = resolveStatus(resolved.status)
  if (resolved.parent !== undefined && resolved.parent !== null) {
    resolved.parent = resolved.parent === "none" ? null : resolved.parent
  }
  const issues = withRelations(loadRawIssues(store))
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
  const issue = readIssue(path, id)
  const others = loadRawIssues(store).filter((row) => row.id !== id)
  return withRelations([...others, issue]).find((row) => row.id === id)!
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
  const all = loadRawIssues(store)
  if (input.id) {
    const path = issuePath(store, input.id)
    if (!existsSync(path)) throw new Error(`issue not found: ${input.id}`)
    const current = readIssue(path, input.id)
    if (input.title !== undefined && !input.title.trim()) {
      throw new Error(
        `invalid title: expected a non-empty string, actual ${JSON.stringify(input.title)}`,
      )
    }
    const nextStatus = status ?? current.status
    const times = statusTimestamps(current, nextStatus, now)
    const parent =
      input.parent !== undefined ? resolveParent(input.id, input.parent, all) : current.parent
    const relations = resolveBlocks(input.id, current.blocks, input, all)
    const issue: Issue = {
      ...current,
      title: input.title !== undefined ? input.title.trim() : current.title,
      status: nextStatus,
      assignee: assignee !== undefined ? assignee : current.assignee,
      labels: input.labels ?? current.labels,
      dueDate: dueDate !== undefined ? dueDate : current.dueDate,
      priority: priority !== undefined ? priority : current.priority,
      parent,
      blocks: relations.blocks,
      startedAt: times.startedAt,
      completedAt: times.completedAt,
      canceledAt: times.canceledAt,
      body: patch ? applyPatch(current.body, patch) : (input.body ?? current.body),
      updatedAt: now,
    }
    writeReplace(path, formatIssue(issue))
    writeBlockOwners(store, relations.owners, now)
    return getIssue(store, issue.id)
  }
  for (;;) {
    const id = nextId(store)
    const created = newIssue(id, input, { assignee, dueDate, priority, status }, now)
    created.parent = input.parent !== undefined ? resolveParent(id, input.parent, all) : null
    const relations = resolveBlocks(id, [], input, all)
    created.blocks = relations.blocks
    try {
      writeCreate(issuePath(store, created.id), formatIssue(created))
      writeBlockOwners(store, relations.owners, now)
      return getIssue(store, created.id)
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
  const status = resolved.status ?? "todo"
  const times = statusTimestamps(null, status, now)
  return {
    id,
    title: input.title.trim(),
    status,
    assignee: resolved.assignee ?? null,
    labels: input.labels ?? [],
    dueDate: resolved.dueDate ?? null,
    priority: resolved.priority ?? null,
    parent: null,
    blocks: [],
    blockedBy: [],
    children: [],
    startedAt: times.startedAt,
    completedAt: times.completedAt,
    canceledAt: times.canceledAt,
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
  if (filter.parent !== undefined) {
    if (filter.parent === null && issue.parent !== null) return false
    if (typeof filter.parent === "string" && issue.parent !== filter.parent) return false
  }
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

function parseIdList(raw: string): string[] {
  return unique(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

function unique(ids: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function statusTimestamps(
  current: Issue | null,
  status: string,
  now: string,
): { startedAt: string | null; completedAt: string | null; canceledAt: string | null } {
  const startedAt = current?.startedAt ?? (status === "in_progress" ? now : null)
  const completedAt =
    status === "done" ? (current?.status === "done" ? current.completedAt : now) : null
  const canceledAt =
    status === "canceled" ? (current?.status === "canceled" ? current.canceledAt : now) : null
  return { startedAt, completedAt, canceledAt }
}

function resolveParent(issueId: string, value: string | null, all: Issue[]): string | null {
  const parent = blankToNull(value) ?? null
  if (parent === null) return null
  if (parent === issueId) {
    throw new Error(`invalid parent: an issue cannot be its own parent, actual ${issueId}`)
  }
  if (!all.some((issue) => issue.id === parent)) {
    throw new Error(`invalid parent: issue not found: ${parent}`)
  }
  if (isDescendant(all, parent, issueId)) {
    throw new Error(`invalid parent: cycle: ${parent} is a descendant of ${issueId}`)
  }
  return parent
}

function isDescendant(all: Issue[], node: string, ancestor: string): boolean {
  const byId = new Map(all.map((issue) => [issue.id, issue]))
  const seen = new Set<string>()
  let current = byId.get(node)
  while (current?.parent) {
    if (current.parent === ancestor) return true
    if (seen.has(current.parent)) return true
    seen.add(current.parent)
    current = byId.get(current.parent)
  }
  return false
}

function resolveBlocks(
  issueId: string,
  currentBlocks: string[],
  input: SaveInput,
  all: Issue[],
): { blocks: string[]; owners: { id: string; blocks: string[] }[] } {
  const hasAddOrRemove =
    input.addBlocks !== undefined ||
    input.removeBlocks !== undefined ||
    input.addBlockedBy !== undefined ||
    input.removeBlockedBy !== undefined
  if (input.blocks !== undefined && hasAddOrRemove) {
    throw new Error(
      "cannot pass blocks with addBlocks, removeBlocks, addBlockedBy, or removeBlockedBy",
    )
  }
  let blocks = currentBlocks.slice()
  if (input.blocks !== undefined) blocks = unique(input.blocks)
  else {
    if (input.removeBlocks) {
      const remove = new Set(input.removeBlocks)
      blocks = blocks.filter((id) => !remove.has(id))
    }
    if (input.addBlocks) blocks = unique([...blocks, ...input.addBlocks])
  }

  const graph = new Map(all.map((issue) => [issue.id, issue.blocks.slice()]))
  if (!graph.has(issueId)) graph.set(issueId, [])
  graph.set(issueId, blocks)

  const owners = new Map<string, string[]>()
  const ownerBlocks = (id: string): string[] => {
    if (!owners.has(id)) {
      const issue = all.find((row) => row.id === id)
      if (!issue) throw new Error(`invalid block: issue not found: ${id}`)
      owners.set(id, issue.blocks.slice())
    }
    return owners.get(id)!
  }

  if (input.removeBlockedBy) {
    for (const id of input.removeBlockedBy) {
      owners.set(
        id,
        ownerBlocks(id).filter((block) => block !== issueId),
      )
      graph.set(id, owners.get(id)!)
    }
  }
  if (input.addBlockedBy) {
    for (const id of unique(input.addBlockedBy)) {
      if (id === issueId) {
        throw new Error(`invalid block: an issue cannot block itself, actual ${issueId}`)
      }
      const next = unique([...ownerBlocks(id), issueId])
      owners.set(id, next)
      graph.set(id, next)
    }
  }

  for (const to of blocks) {
    if (to === issueId) {
      throw new Error(`invalid block: an issue cannot block itself, actual ${issueId}`)
    }
    if (!all.some((issue) => issue.id === to)) {
      throw new Error(`invalid block: issue not found: ${to}`)
    }
  }

  const newEdges: [string, string][] = []
  for (const to of blocks) {
    if (!currentBlocks.includes(to)) newEdges.push([issueId, to])
  }
  if (input.addBlockedBy) {
    for (const id of unique(input.addBlockedBy)) newEdges.push([id, issueId])
  }
  for (const [from, to] of newEdges) {
    if (hasPath(graph, to, from)) {
      throw new Error(`invalid block: cycle: ${from} already blocked by ${to}`)
    }
  }

  return {
    blocks,
    owners: [...owners].map(([id, next]) => ({ id, blocks: next })),
  }
}

function hasPath(graph: Map<string, string[]>, from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node === to) return true
    if (seen.has(node)) continue
    seen.add(node)
    for (const next of graph.get(node) ?? []) stack.push(next)
  }
  return false
}

function writeBlockOwners(
  store: Store,
  owners: { id: string; blocks: string[] }[],
  now: string,
): void {
  for (const owner of owners) {
    const path = issuePath(store, owner.id)
    const issue = readIssue(path, owner.id)
    writeReplace(path, formatIssue({ ...issue, blocks: owner.blocks, updatedAt: now }))
  }
}

export function listComments(store: Store, filter: { issue: string }): Comment[] {
  getIssue(store, filter.issue)
  const comments = loadRawComments(store).filter((comment) => comment.issue === filter.issue)
  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return comments
}

export function getComment(store: Store, id: string): Comment {
  const path = commentPath(store, id)
  if (!existsSync(path)) throw new Error(`comment not found: ${id}`)
  return readComment(path, id)
}

export function saveComment(store: Store, input: SaveCommentInput): Comment {
  const now = new Date().toISOString()
  if (input.id) {
    const current = getComment(store, input.id)
    if (input.body !== undefined && !input.body.trim()) {
      throw new Error(
        `invalid body: expected a non-empty string, actual ${JSON.stringify(input.body)}`,
      )
    }
    const comment: Comment = {
      ...current,
      body: input.body !== undefined ? input.body : current.body,
      updatedAt: now,
    }
    writeReplace(commentPath(store, comment.id), formatComment(comment))
    return comment
  }
  const parent = input.parent ? getComment(store, input.parent) : null
  const issue = parent ? parent.issue : input.issue
  if (!issue) throw new Error("issue is required when creating a comment")
  getIssue(store, issue)
  if (!input.body?.trim()) {
    throw new Error(
      `invalid body: expected a non-empty string, actual ${JSON.stringify(input.body ?? "")}`,
    )
  }
  mkdirSync(join(store.dir, "comments"), { recursive: true })
  for (;;) {
    const comment: Comment = {
      id: nextCommentId(store),
      issue,
      parent: parent ? parent.id : null,
      author: gitName(),
      createdAt: now,
      updatedAt: now,
      body: input.body,
    }
    try {
      writeCreate(commentPath(store, comment.id), formatComment(comment))
      return comment
    } catch (err) {
      if (!isEexist(err)) throw err
    }
  }
}

function loadRawComments(store: Store): Comment[] {
  const dir = join(store.dir, "comments")
  if (!existsSync(dir)) return []
  const comments: Comment[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue
    try {
      comments.push(readComment(join(dir, name), name.slice(0, -3)))
    } catch {
      // 壊れた手編集ファイルが一覧全体を隠さないようにする
    }
  }
  return comments
}

function commentPath(store: Store, id: string): string {
  return join(store.dir, "comments", `${id}.md`)
}

function nextCommentId(store: Store): string {
  const dir = join(store.dir, "comments")
  let max = 0
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const match = name.match(/^(\d+)\.md$/)
      if (!match) continue
      const n = Number(match[1])
      if (n > max) max = n
    }
  }
  return String(max + 1)
}

function readComment(path: string, stem: string): Comment {
  const { meta, body } = parseFrontmatter(readFileSync(path, "utf8"))
  if (!meta.issue) throw new Error("invalid comment file")
  return {
    id: stem,
    issue: meta.issue,
    parent: blankToNull(meta.parent ?? "") ?? null,
    author: meta.author || gitName(),
    createdAt: meta.createdAt || "",
    updatedAt: meta.updatedAt || "",
    body,
  }
}

function formatComment(comment: Comment): string {
  return formatDocument(
    [
      ["id", comment.id],
      ["issue", comment.issue],
      ["parent", comment.parent ?? ""],
      ["author", comment.author],
      ["createdAt", comment.createdAt],
      ["updatedAt", comment.updatedAt],
    ],
    comment.body,
  )
}

function issuePath(store: Store, id: string): string {
  return join(store.dir, "issues", `${id}.md`)
}

function readIssue(path: string, stem: string): Issue {
  const issue = parseIssue(readFileSync(path, "utf8"))
  issue.id = stem
  return issue
}

function writeCreate(path: string, text: string): void {
  writeFileSync(path, text, { flag: "wx" })
}

function writeReplace(path: string, text: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
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
  return { meta, body }
}

function parseIssue(text: string): Issue {
  const { meta, body } = parseFrontmatter(text)
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
    parent: blankToNull(meta.parent ?? "") ?? null,
    blocks: parseIdList(meta.blocks || ""),
    blockedBy: [],
    children: [],
    startedAt: blankToNull(meta.startedAt ?? "") ?? null,
    completedAt: blankToNull(meta.completedAt ?? "") ?? null,
    canceledAt: blankToNull(meta.canceledAt ?? "") ?? null,
    createdAt: meta.createdAt || "",
    updatedAt: meta.updatedAt || "",
    body,
  }
}

function formatIssue(issue: Issue): string {
  return formatDocument(
    [
      ["id", issue.id],
      ["title", issue.title.replace(/\n/g, " ")],
      ["status", issue.status],
      ["assignee", issue.assignee ?? ""],
      ["labels", issue.labels.join(", ")],
      ["dueDate", issue.dueDate ?? ""],
      ["priority", issue.priority ?? ""],
      ["parent", issue.parent ?? ""],
      ["blocks", issue.blocks.join(", ")],
      ["startedAt", issue.startedAt ?? ""],
      ["completedAt", issue.completedAt ?? ""],
      ["canceledAt", issue.canceledAt ?? ""],
      ["createdAt", issue.createdAt],
      ["updatedAt", issue.updatedAt],
    ],
    issue.body,
  )
}

// 空の値を `key: ` と書くと行末に空白が残り、.yaru を整形ツールにかけたときに差分が出るため `key:` と書く
function formatDocument(fields: [key: string, value: string][], body: string): string {
  const frontmatter = fields
    .map(([key, value]) => (value === "" ? `${key}:` : `${key}: ${value}`))
    .join("\n")
  return `---\n${frontmatter}\n---\n\n${body}\n`
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
