import type { Issue } from "../../store"
import type { ViewMode } from "../../page"
import type { PageFilters } from "../view-model"
import { BoardView } from "./board-view"
import { EmptyBoard } from "./empty-board"
import { ListView } from "./list-view"

// 見出しの下の本体。issue が無ければ空の案内を、あれば選んだ表示形式 (板か一覧) で描く

export function BoardContent({
  issues,
  filters,
  view,
  selectedIssueId,
  onMoveIssue,
}: {
  issues: Issue[]
  filters: PageFilters
  view: ViewMode
  selectedIssueId: string | null
  onMoveIssue: (issueId: string, status: string) => Promise<void>
}) {
  if (issues.length === 0) return <EmptyBoard filters={filters} />
  if (view === "list") {
    return <ListView issues={issues} filters={filters} selectedIssueId={selectedIssueId} />
  }
  return (
    <BoardView
      issues={issues}
      filters={filters}
      selectedIssueId={selectedIssueId}
      onMoveIssue={onMoveIssue}
    />
  )
}
