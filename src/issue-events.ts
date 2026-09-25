import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Issue, Store } from "./store"

// issue の属性がいつ・誰に・どのセッションで変えられたかを残す
// frontmatter は今の値しか持たないので、「いつ進行中になったか」「誰が優先度を上げたか」を後から辿れないため
// issue ごとに .yaru/events/<id>.jsonl へ 1 行 1 件で追記する。追記だけなので、並列のエージェントが同時に書いても行が混ざらない
// https://jsonlines.org/

// 人やエージェントが決める属性だけを残す。startedAt や updatedAt は status や保存から決まる値なので残さない
// 本文は長く、差分は git で辿れるので残さない
export const TRACKED_ISSUE_FIELDS = [
  "title",
  "status",
  "assignee",
  "labels",
  "dueDate",
  "priority",
  "parent",
  "blocks",
] as const
export type TrackedIssueField = (typeof TRACKED_ISSUE_FIELDS)[number]

export type IssueEventValue = string | string[] | null

export type IssueEvent = {
  field: TrackedIssueField
  from: IssueEventValue
  to: IssueEventValue
  // 保存した人の git の名前
  by: string
  // エージェントが保存したときのセッション ID。画面や人の手の保存では null
  session: string | null
  at: string
}

export type IssueChange = Pick<IssueEvent, "field" | "from" | "to">

export function diffIssue(before: Issue, after: Issue): IssueChange[] {
  const changes: IssueChange[] = []
  for (const field of TRACKED_ISSUE_FIELDS) {
    const from = before[field]
    const to = after[field]
    if (sameValue(from, to)) continue
    changes.push({ field, from: copyValue(from), to: copyValue(to) })
  }
  return changes
}

export function appendIssueEvents(
  store: Store,
  issueId: string,
  changes: IssueChange[],
  context: { by: string; session: string | null; at: string },
): void {
  if (changes.length === 0) return
  const directory = join(store.dir, "events")
  mkdirSync(directory, { recursive: true })
  const lines = changes
    .map((change) => JSON.stringify({ ...change, ...context } satisfies IssueEvent))
    .join("\n")
  appendFileSync(eventPath(store, issueId), `${lines}\n`)
}

export function issueEvents(store: Store, issueId: string): IssueEvent[] {
  if (!existsSync(join(store.dir, "issues", `${issueId}.md`))) {
    throw new Error(`issue not found: ${issueId}`)
  }
  const path = eventPath(store, issueId)
  if (!existsSync(path)) return []
  const events: IssueEvent[] = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue
    const event = parseEvent(line)
    // 手で直して壊れた行や書きかけの行があっても、残りの履歴は見せる
    if (event) events.push(event)
  }
  return events
}

function eventPath(store: Store, issueId: string): string {
  return join(store.dir, "events", `${issueId}.jsonl`)
}

function parseEvent(line: string): IssueEvent | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (!(TRACKED_ISSUE_FIELDS as readonly unknown[]).includes(record.field)) return null
  if (!isEventValue(record.from) || !isEventValue(record.to)) return null
  if (typeof record.by !== "string" || typeof record.at !== "string") return null
  if (record.session !== null && typeof record.session !== "string") return null
  return {
    field: record.field as TrackedIssueField,
    from: record.from,
    to: record.to,
    by: record.by,
    session: record.session,
    at: record.at,
  }
}

function isEventValue(value: unknown): value is IssueEventValue {
  if (value === null || typeof value === "string") return true
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function sameValue(left: IssueEventValue, right: IssueEventValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index])
  }
  return left === right
}

function copyValue(value: IssueEventValue): IssueEventValue {
  return Array.isArray(value) ? value.slice() : value
}
