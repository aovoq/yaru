import type { Issue } from "../store"
import { PriorityIcon } from "./icons/priority-icon"
import { StatusIcon } from "./icons/status-icon"
import { Avatar } from "./avatar"
import { DueStamp } from "./due-stamp"

// issue の行を並べた一覧。行を押すとその issue を開き、右クリックのメニューも開ける (data-id)
// 子 issue・関係・dashboard の作業中や期限切れなど、issue を数件並べる場所で共通に使う

export function IssueLinkList({
  issues,
  hrefFor,
  showDueDate = false,
}: {
  issues: Issue[]
  hrefFor: (issue: Issue) => string
  showDueDate?: boolean
}) {
  return (
    <ul class="flex flex-col overflow-hidden rounded-lg border border-hairline bg-surface-1">
      {issues.map((issue) => (
        <li key={issue.id} class="border-b border-hairline last:border-b-0">
          <a
            href={hrefFor(issue)}
            data-id={issue.id}
            class="flex min-h-9 items-center gap-2.5 px-3 py-1.5 no-underline transition-colors hover:bg-surface-2"
          >
            <PriorityIcon priority={issue.priority} />
            <span class="w-10 shrink-0 font-mono text-[11px] text-ink-tertiary">#{issue.id}</span>
            <StatusIcon status={issue.status} />
            <span
              class={`min-w-0 flex-1 truncate text-[13px] ${
                issue.status === "done" || issue.status === "canceled"
                  ? "text-ink-subtle"
                  : "text-ink"
              }`}
            >
              {issue.title}
            </span>
            {showDueDate ? <DueStamp date={issue.dueDate} /> : null}
            {issue.assignee ? <Avatar name={issue.assignee} /> : null}
          </a>
        </li>
      ))}
    </ul>
  )
}
