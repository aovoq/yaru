import type { Issue } from "../../store"
import { PriorityIcon, StatusIcon } from "../../components/icons"
import { Avatar, DueStamp, LabelChip } from "../../components/issue-metadata"
import { issueColumns, pageHref, statusLabel, type PageFilters } from "../view-model"

// 状態ごとの見出しの下に issue を 1 行ずつ並べる一覧の表示。issue の無い状態は見出しごと省く

export function ListView({
  issues,
  filters,
  selectedIssueId,
}: {
  issues: Issue[]
  filters: PageFilters
  selectedIssueId: string | null
}) {
  return (
    <main id="board" class="min-h-0 flex-1 overflow-y-auto">
      {issueColumns(issues).map((status) => {
        const items = issues.filter((issue) => issue.status === status)
        if (items.length === 0) return null
        return (
          <section data-status={status}>
            <div class="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-hairline bg-surface-1 px-4">
              <StatusIcon status={status} />
              <h2 class="text-[13px] font-medium text-ink">{statusLabel(status)}</h2>
              <span class="text-xs text-ink-tertiary tabular-nums">{items.length}</span>
            </div>
            {items.map((issue) => (
              <IssueRow issue={issue} filters={filters} selected={selectedIssueId === issue.id} />
            ))}
          </section>
        )
      })}
    </main>
  )
}

function IssueRow({
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
