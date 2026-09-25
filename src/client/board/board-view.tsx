import { useState } from "preact/hooks"
import type { Issue } from "../../store"
import { issueColumns, type PageFilters } from "../view-model"
import { BoardColumn } from "./board-column"
import { IssueCard } from "./issue-card"

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
  const shown = filters.status
    ? issueColumns(issues).filter((status) => status === filters.status)
    : issueColumns(issues)
  return (
    <main id="board" class="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 py-3">
      {shown.map((status) => {
        const items = issues.filter((issue) => issue.status === status)
        return (
          <BoardColumn
            status={status}
            filters={filters}
            count={items.length}
            draggingIssueId={draggingIssueId}
            onDropIssue={(issueId) => {
              setDraggingIssueId(null)
              if (!issueId || issues.find((issue) => issue.id === issueId)?.status === status)
                return
              void onMoveIssue(issueId, status)
            }}
          >
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
                onDragEnd={() => setDraggingIssueId(null)}
              />
            ))}
          </BoardColumn>
        )
      })}
    </main>
  )
}
