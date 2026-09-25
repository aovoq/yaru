import type { Issue } from "../../store"
import { issueColumns, type PageFilters } from "../view-model"
import { IssueRow } from "./issue-row"
import { StatusHeading } from "./status-heading"

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
            <StatusHeading
              status={status}
              count={items.length}
              class="sticky top-0 z-10 h-9 border-b border-hairline bg-surface-1 px-4"
            />
            {items.map((issue) => (
              <IssueRow issue={issue} filters={filters} selected={selectedIssueId === issue.id} />
            ))}
          </section>
        )
      })}
    </main>
  )
}
