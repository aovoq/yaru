import { Avatar } from "../../components/avatar"
import { EmptyAvatar } from "../../components/empty-avatar"
import { PriorityIcon } from "../../components/icons/priority-icon"
import { StatusIcon } from "../../components/icons/status-icon"
import type { IssueEvent } from "../../issue-events"
import { PRIORITIES, type Priority } from "../../store"

// 活動欄で、属性の変更の行の軸に置くアイコン。変えた後の値を、属性欄と同じアイコンで見せる
// 状態・優先度・担当者のほかは、値を絵にできないので小さな点にする
// 隣の 1 文が値を言葉で書いているので、アイコンは読み上げから外す

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
