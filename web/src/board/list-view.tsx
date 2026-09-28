import type { AwaitingSummary } from "./page-data"
import type { IssueSection, PageFilters } from "./view-model"
import { GroupHeading } from "./group-heading"
import { IssueRow } from "./issue-row"

// まとまりごとの見出しの下に issue を 1 行ずつ並べる一覧の表示。issue の無いまとまりは見出しごと省く
// まとまりに分けないとき (group=none) は見出しを出さずに全ての行を続けて並べる

export function ListView({
  sections,
  filters,
  selectedIssueId,
  awaitingByIssue,
  labelColors,
  now,
}: {
  sections: IssueSection[]
  filters: PageFilters
  selectedIssueId: string | null
  awaitingByIssue: Record<string, AwaitingSummary>
  labelColors: Map<string, string>
  now: Date
}) {
  return (
    <main id="board" class="min-h-0 flex-1 overflow-y-auto">
      {sections.map((section) => {
        if (section.issues.length === 0) return null
        return (
          <section
            key={section.key}
            data-status={section.group === "status" ? (section.value ?? undefined) : undefined}
            data-group={section.key}
          >
            {section.group === "none" ? null : (
              <GroupHeading
                section={section}
                labelColors={labelColors}
                class="sticky top-0 z-10 h-9 border-b border-hairline/60 bg-surface-1 pr-4 pl-9"
              />
            )}
            {section.issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                filters={filters}
                selected={selectedIssueId === issue.id}
                awaiting={awaitingByIssue[issue.id]}
                labelColors={labelColors}
                now={now}
              />
            ))}
          </section>
        )
      })}
    </main>
  )
}
