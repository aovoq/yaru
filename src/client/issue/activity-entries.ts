import type { IssueEvent, IssueEventValue } from "../../issue-events"
import { PRIORITIES, type Comment, type Issue, type Priority } from "../../store"
import { priorityLabel, statusLabel } from "../view-model"

// issue 画面の活動欄に並べる項目を作る。作った・始めた・終えたといった出来事、属性の変更、コメントを、時刻順の 1 本の流れにする
// 時刻が同じときは作成 → 開始 → 完了 → 属性の変更 → コメントの順に並べる
// 属性の変更の記録 (.yaru/events) には状態の変更も入る。記録があるときは、時刻の欄 (startedAt など) から作る
// 始めた・終えたの出来事を出さない。同じ変化が 2 行に並んでしまうため。記録が始まる前の issue は時刻の欄から作る

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
  // 同じ時刻に同じ項目が 2 度変わることもあるので、key には並びの番号も入れる
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

const FIELD_NAMES: Record<IssueEvent["field"], string> = {
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
// ラベルと blocks は一覧なので、前後の全部を並べず、足したものと外したものだけを書く
export function describeIssueEvent(event: IssueEvent): string {
  const name = FIELD_NAMES[event.field]
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

function formatValue(field: IssueEvent["field"], value: string | null): string {
  if (value === null) return ""
  if (field === "status") return statusLabel(value)
  if (field === "priority" && (PRIORITIES as readonly string[]).includes(value)) {
    return priorityLabel(value as Priority)
  }
  if (field === "parent" || field === "blocks") return `#${value}`
  return value
}
