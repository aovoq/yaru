import type { Issue } from "../../store"
import { Avatar } from "../../components/avatar"
import { DueStamp } from "../../components/due-stamp"
import { FOCUS_RING } from "../../components/focus-ring"
import { PriorityIcon } from "../../components/icons/priority-icon"
import { LabelChip } from "../../components/label-chip"
import { pageHref, type PageFilters } from "../view-model"

// 板の列に並べる issue の 1 枚。押すと issue を開き、引きずると別の列へ移せる
// 右クリックのメニュー (data-id) と、j / k で選んだ印 (aria-selected) もこの要素に付ける
// Card は a として描けないので、枠と面のクラスはここで持つ

export function IssueCard({
  issue,
  filters,
  selected,
  onDragStart,
  onDragEnd,
}: {
  issue: Issue
  filters: PageFilters
  selected: boolean
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
}) {
  return (
    <a
      href={pageHref(filters, issue.id)}
      data-id={issue.id}
      data-status={issue.status}
      draggable={true}
      aria-selected={selected ? "true" : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      class={`mb-2 block cursor-pointer rounded-lg border border-hairline bg-surface-1 p-3 text-ink no-underline shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.03)] transition-colors select-none hover:border-hairline-strong hover:bg-surface-2 aria-selected:border-primary/60 ${FOCUS_RING}`}
    >
      <div class="flex items-center justify-between gap-2">
        <span class="font-mono text-[11px] text-ink-tertiary">{issue.id}</span>
        {issue.assignee ? <Avatar name={issue.assignee} /> : null}
      </div>
      <div class="mt-1 line-clamp-2 text-[13px] leading-snug font-medium tracking-tight text-ink">
        {issue.title}
      </div>
      {issue.priority || issue.dueDate || issue.labels.length > 0 ? (
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <PriorityIcon priority={issue.priority} />
          <DueStamp date={issue.dueDate} />
          {issue.labels.map((label) => (
            <LabelChip label={label} />
          ))}
        </div>
      ) : null}
    </a>
  )
}
