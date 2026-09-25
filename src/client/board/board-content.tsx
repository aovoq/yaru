import type { IssueGroup } from "../../issue-order"
import type { AwaitingSummary, ViewMode } from "../../page"
import type { Issue } from "../../store"
import { groupIssues, type PageFilters } from "../view-model"
import { BoardView } from "./board-view"
import { EmptyBoard } from "./empty-board"
import { ListView } from "./list-view"

// 見出しの下の本体。issue が無ければ空の案内を、あれば選んだ表示形式 (板か一覧) で、選んだまとまり (group) ごとに分けて描く

export function BoardContent({
  issues,
  totalIssueCount,
  filters,
  view,
  group,
  selectedIssueId,
  awaitingByIssue,
  labelColors,
  now,
  onMoveIssue,
}: {
  issues: Issue[]
  // 絞り込む前の issue の数。何も無いのか、終わった issue を隠しているだけなのかを空の案内で言い分けるのに使う
  totalIssueCount: number
  filters: PageFilters
  view: ViewMode
  group: IssueGroup
  selectedIssueId: string | null
  awaitingByIssue: Record<string, AwaitingSummary>
  labelColors: Map<string, string>
  now: Date
  onMoveIssue: (issueId: string, status: string) => Promise<void>
}) {
  if (issues.length === 0) return <EmptyBoard filters={filters} totalIssueCount={totalIssueCount} />
  const sections = groupIssues(issues, group)
  if (view === "list") {
    return (
      <ListView
        sections={sections}
        filters={filters}
        selectedIssueId={selectedIssueId}
        awaitingByIssue={awaitingByIssue}
        labelColors={labelColors}
        now={now}
      />
    )
  }
  return (
    <BoardView
      sections={sections}
      filters={filters}
      selectedIssueId={selectedIssueId}
      awaitingByIssue={awaitingByIssue}
      labelColors={labelColors}
      now={now}
      onMoveIssue={onMoveIssue}
    />
  )
}
