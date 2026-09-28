import { PRIORITIES, type Issue, type Priority } from "../domain/issue"
import { priorityLabel, statusLabel } from "./filters"
import type { Comment } from "../domain/comment"
import type { IssueEvent, IssueEventValue } from "../domain/issue-event"

// issue 画面の活動欄に並べる項目。時刻が同じときは作成 → 開始 → 完了 → 属性の変更 → コメントの順
// 属性の変更の記録があるときは、時刻の欄 (startedAt など) から作る始めた・終えたを出さない。同じ変化が 2 行に並ぶため

export type ActivityEntry =
  | { kind: "lifecycle"; key: string; at: string; order: number; text: string; status: string }
  | { kind: "change"; key: string; at: string; order: number; event: IssueEvent }
  | { kind: "comment"; key: string; at: string; order: number; comment: Comment }

export function activityEntries(
  issue: Issue,
  comments: Comment[],
  events: IssueEvent[],
): ActivityEntry[] {
  const entries: ActivityEntry[] = []
  const lifecycle = (at: string | null, order: number, text: string, status: string) => {
    if (at) entries.push({ kind: "lifecycle", key: `lifecycle-${text}`, at, order, text, status })
  }
  lifecycle(issue.createdAt, 0, "created the issue", "todo")
  if (!events.some((event) => event.field === "status")) {
    lifecycle(issue.startedAt, 1, "started working", "in_progress")
    lifecycle(issue.completedAt, 2, "completed the issue", "done")
    lifecycle(issue.canceledAt, 2, "canceled the issue", "canceled")
  }
  events.forEach((event, index) => {
    entries.push({
      kind: "change",
      key: `change-${index}-${event.at}-${event.field}`,
      at: event.at,
      order: 3,
      event,
    })
  })
  for (const comment of comments) {
    entries.push({
      kind: "comment",
      key: `comment-${comment.id}`,
      at: comment.createdAt,
      order: 4,
      comment,
    })
  }
  entries.sort((left, right) => left.at.localeCompare(right.at) || left.order - right.order)
  return entries
}

const FIELD_NAMES: Record<string, string> = {
  title: "title",
  status: "status",
  assignee: "assignee",
  labels: "label",
  dueDate: "due date",
  priority: "priority",
  parent: "parent",
  blocks: "blocks",
}

// 属性の変更を「changed priority High → Urgent」のような 1 文にする。誰が変えたかは呼ぶ側が前に付ける
export function describeIssueEvent(event: IssueEvent): string {
  const name = FIELD_NAMES[event.field] ?? event.field
  if (Array.isArray(event.from) || Array.isArray(event.to)) {
    const before = listValue(event.from)
    const after = listValue(event.to)
    const added = after.filter((item) => !before.includes(item))
    const removed = before.filter((item) => !after.includes(item))
    const format = (items: string[]) =>
      items.map((item) => formatValue(event.field, item)).join(", ")
    return [
      added.length > 0 ? `added ${name} ${format(added)}` : "",
      removed.length > 0 ? `removed ${name} ${format(removed)}` : "",
    ]
      .filter(Boolean)
      .join(", ")
  }
  if (event.from === null) return `set ${name} to ${formatValue(event.field, event.to)}`
  if (event.to === null) return `removed ${name} ${formatValue(event.field, event.from)}`
  return `changed ${name} ${formatValue(event.field, event.from)} → ${formatValue(event.field, event.to)}`
}

function listValue(value: IssueEventValue): string[] {
  if (value === null) return []
  return Array.isArray(value) ? value : [value]
}

function formatValue(field: string, value: string | null): string {
  if (value === null) return ""
  if (field === "status") return statusLabel(value)
  if (field === "priority" && (PRIORITIES as readonly string[]).includes(value)) {
    return priorityLabel(value as Priority)
  }
  if (field === "parent" || field === "blocks") return `#${value}`
  return value
}
