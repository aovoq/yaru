import { formatDueDate, isIssueOverdue } from "../issue-dates"

// issue の期日。「Oct 20」のように短く出し、hover で元の日付 (ISO) を見せる
// 期日を過ぎた未完了の issue は危険の色で示し、色の見分けがつかない人と読み上げのために「Overdue」の言葉も添える
// status は issue の状態。done・canceled の issue は期日を過ぎても期限切れにしない (issue-dates.ts)
// https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html

export function DueStamp({
  date,
  status = "todo",
  now = new Date(),
}: {
  date: string | null
  status?: string
  now?: Date
}) {
  if (!date) return null
  const overdue = isIssueOverdue({ dueDate: date, status }, now)
  return (
    <time
      datetime={date}
      title={date}
      data-overdue={overdue ? "" : undefined}
      class={`text-small whitespace-nowrap tabular-nums ${overdue ? "text-semantic-danger" : "text-ink-subtle"}`}
    >
      {overdue ? <span class="sr-only">Overdue: </span> : null}
      {formatDueDate(date, now)}
    </time>
  )
}
