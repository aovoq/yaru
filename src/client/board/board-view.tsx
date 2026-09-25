import { useState } from "preact/hooks"
import type { Issue } from "../../store"
import { PlusIcon, PriorityIcon, StatusIcon } from "../../components/icons"
import { Avatar, DueStamp, LabelChip } from "../../components/issue-metadata"
import { issueColumns, newIssueHref, pageHref, statusLabel, type PageFilters } from "../view-model"

// 状態ごとの列にカードを並べる板の表示。カードを別の列へ引きずって落とすと状態を変える

export function BoardView({
  issues,
  filters,
  selectedIssueId,
  onMoveIssue,
}: {
  issues: Issue[]
  filters: PageFilters
  selectedIssueId: string | null
  onMoveIssue: (issueId: string, status: string) => Promise<void>
}) {
  const [draggingIssueId, setDraggingIssueId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<string | null>(null)
  const shown = filters.status
    ? issueColumns(issues).filter((status) => status === filters.status)
    : issueColumns(issues)
  return (
    <main id="board" class="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 py-3">
      {shown.map((status) => {
        const items = issues.filter((issue) => issue.status === status)
        return (
          <section
            data-status={status}
            data-over={overStatus === status ? "" : undefined}
            onDragOver={(event: DragEvent) => {
              if (!draggingIssueId) return
              event.preventDefault()
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
              setOverStatus(status)
            }}
            onDragLeave={(event: DragEvent) => {
              const relatedTarget = event.relatedTarget
              const currentTarget = event.currentTarget
              if (
                !(relatedTarget instanceof Node) ||
                !(currentTarget instanceof Node) ||
                !currentTarget.contains(relatedTarget)
              ) {
                setOverStatus(null)
              }
            }}
            onDrop={(event: DragEvent) => {
              event.preventDefault()
              const issueId = event.dataTransfer?.getData("text/plain") || draggingIssueId
              setDraggingIssueId(null)
              setOverStatus(null)
              if (!issueId || issues.find((issue) => issue.id === issueId)?.status === status)
                return
              void onMoveIssue(issueId, status)
            }}
            class="group flex h-full w-[300px] shrink-0 flex-col rounded-lg transition-colors data-[over]:bg-surface-1"
          >
            <div class="flex shrink-0 items-center gap-2 px-2 py-2">
              <StatusIcon status={status} />
              <h2 class="text-[13px] font-medium tracking-tight text-ink">{statusLabel(status)}</h2>
              <span class="text-xs text-ink-tertiary tabular-nums">{items.length}</span>
              <a
                href={newIssueHref(filters, status)}
                title={`New ${statusLabel(status)} issue`}
                class="ml-auto grid size-5 place-items-center rounded text-ink-tertiary opacity-0 no-underline transition-opacity group-hover:opacity-100 hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
              >
                <PlusIcon />
              </a>
            </div>
            <div class="min-h-16 flex-1 overflow-y-auto px-2 pb-2">
              {items.map((issue) => (
                <IssueCard
                  issue={issue}
                  filters={filters}
                  selected={selectedIssueId === issue.id}
                  onDragStart={(event) => {
                    setDraggingIssueId(issue.id)
                    event.dataTransfer?.setData("text/plain", issue.id)
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
                  }}
                  onDragEnd={() => {
                    setDraggingIssueId(null)
                    setOverStatus(null)
                  }}
                />
              ))}
            </div>
          </section>
        )
      })}
    </main>
  )
}

function IssueCard({
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
      class="mb-2 block cursor-pointer rounded-lg border border-hairline bg-surface-1 p-3 text-ink no-underline shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.03)] transition-colors select-none hover:border-hairline-strong hover:bg-surface-2 aria-selected:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
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
