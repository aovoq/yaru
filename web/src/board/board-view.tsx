import { useState } from "preact/hooks"
import type { AwaitingSummary } from "./page-data"
import type { IssueSection, PageFilters } from "./view-model"
import { BoardColumn } from "./board-column"
import { IssueCard } from "./issue-card"

// まとまりごとの列にカードを並べる板の表示。状態で分けているときだけ、カードを別の列へ引きずって落とすと状態を変える
// 状態で分けて状態で絞り込んでいるときは、その状態の列だけを出す
// スマホ幅では列を画面の 85% の幅にし、横に流すと 1 列ずつ止まるようにする (scroll-snap)。次の列の端が見えて、横に流せると分かるようにするため

export function BoardView({
  sections,
  filters,
  selectedIssueId,
  awaitingByIssue,
  labelColors,
  now,
  onMoveIssue,
}: {
  sections: IssueSection[]
  filters: PageFilters
  selectedIssueId: string | null
  awaitingByIssue: Record<string, AwaitingSummary>
  labelColors: Map<string, string>
  now: Date
  onMoveIssue: (issueId: string, status: string) => Promise<void>
}) {
  const [draggingIssueId, setDraggingIssueId] = useState<string | null>(null)
  const shown = sections.filter(
    (section) => section.group !== "status" || !filters.status || section.value === filters.status,
  )
  return (
    <main
      id="board"
      class="flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 py-3 sm:snap-none"
    >
      {shown.map((section) => {
        const byStatus = section.group === "status" && section.value !== null
        return (
          <BoardColumn
            key={section.key}
            section={section}
            filters={filters}
            labelColors={labelColors}
            draggingIssueId={draggingIssueId}
            onDropIssue={(issueId) => {
              setDraggingIssueId(null)
              if (!byStatus || !issueId) return
              if (section.issues.some((issue) => issue.id === issueId)) return
              void onMoveIssue(issueId, section.value!)
            }}
          >
            {section.issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                filters={filters}
                selected={selectedIssueId === issue.id}
                draggable={byStatus}
                showStatus={!byStatus}
                awaiting={awaitingByIssue[issue.id]}
                labelColors={labelColors}
                now={now}
                onDragStart={(event) => {
                  setDraggingIssueId(issue.id)
                  event.dataTransfer?.setData("text/plain", issue.id)
                  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
                }}
                onDragEnd={() => setDraggingIssueId(null)}
              />
            ))}
          </BoardColumn>
        )
      })}
    </main>
  )
}
