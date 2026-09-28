import { Avatar } from "../components/avatar"
import { EmptyAvatar } from "../components/empty-avatar"
import { PriorityIcon } from "../components/icons/priority-icon"
import { StatusIcon } from "../components/icons/status-icon"
import { PRIORITIES, type Priority } from "../domain/issue"
import type { IssueEvent } from "../domain/issue-event"

// 活動欄で、属性の変更の行の軸に置くアイコン。変えた後の値を属性欄と同じアイコンで見せる

export function ActivityChangeIcon({ event }: { event: IssueEvent }) {
  const value = typeof event.to === "string" ? event.to : null
  if (event.field === "status" && value) return <StatusIcon status={value} decorative />
  if (event.field === "priority") {
    const priority = (PRIORITIES as readonly string[]).includes(value ?? "")
      ? (value as Priority)
      : null
    return <PriorityIcon priority={priority} decorative />
  }
  if (event.field === "assignee") {
    return value ? (
      <span aria-hidden="true">
        <Avatar name={value} />
      </span>
    ) : (
      <EmptyAvatar />
    )
  }
  return <span aria-hidden="true" class="size-1.5 rounded-full bg-ink-tertiary" />
}
