import type { Issue } from "../../store"
import { Avatar } from "../../components/avatar"
import { DueStamp } from "../../components/due-stamp"
import { PriorityIcon } from "../../components/icons/priority-icon"
import { LabelChip } from "../../components/label-chip"
import { pageHref, type PageFilters } from "../view-model"

// 一覧の表示の issue の 1 行。押すと issue を開く。右クリックのメニュー (data-id) と、j / k で選んだ印 (aria-selected) もここに付ける
// 行は画面の端まで広がり、外側に出る focus の枠は左右で切れてしまうので、FOCUS_RING ではなく内側に引いた枠を使う

export function IssueRow({
  issue,
  filters,
  selected,
}: {
  issue: Issue
  filters: PageFilters
  selected: boolean
}) {
  return (
    <a
      href={pageHref(filters, issue.id)}
      data-id={issue.id}
      data-status={issue.status}
      aria-selected={selected ? "true" : undefined}
      class="flex h-10 items-center gap-3 border-b border-hairline/60 px-4 text-ink no-underline transition-colors hover:bg-surface-1 aria-selected:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-focus/50"
    >
      <span class="w-4 shrink-0">
        <PriorityIcon priority={issue.priority} />
      </span>
      <span class="w-8 shrink-0 font-mono text-[11px] text-ink-tertiary">{issue.id}</span>
      <span class="min-w-0 flex-1 truncate text-[13px] font-medium">{issue.title}</span>
      <span class="hidden shrink-0 items-center gap-1.5 lg:flex">
        {issue.labels.map((label) => (
          <LabelChip label={label} />
        ))}
      </span>
      <span class="hidden w-20 shrink-0 text-right sm:inline">
        <DueStamp date={issue.dueDate} />
      </span>
      <span class="w-[18px] shrink-0">
        {issue.assignee ? <Avatar name={issue.assignee} /> : null}
      </span>
    </a>
  )
}
