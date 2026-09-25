import { isOverdue } from "../store"

// issue の期日。過ぎていれば危険の色で示す
export function DueStamp({ date }: { date: string | null }) {
  if (!date) return null
  const overdue = isOverdue(date)
  return (
    <span
      data-overdue={overdue ? "" : undefined}
      class={`font-mono text-[11px] ${overdue ? "text-semantic-danger" : "text-ink-subtle"}`}
    >
      {date}
    </span>
  )
}
