import { IssueLinkList } from "../../components/issue-link-list"
import { ProgressBar } from "../../components/progress-bar"
import { Section } from "../../components/section"
import type { Issue } from "../../store"
import { pageHref, type PageFilters } from "../view-model"

// issue 画面の子 issue の一覧。見出しの右に、終わった数の割合を棒と「1/2」の数で見せる
// 子 issue が無ければ何も出さない

export function SubIssues({
  issue,
  all,
  filters,
}: {
  issue: Issue
  all: Issue[]
  filters: PageFilters
}) {
  const children = all.filter((other) => other.parent === issue.id)
  if (children.length === 0) return null
  const done = children.filter((child) => child.status === "done").length
  return (
    <Section
      title="Sub-issues"
      aside={
        <span class="flex items-center gap-2 text-[11px] text-ink-tertiary tabular-nums">
          <ProgressBar value={done} max={children.length} />
          {done}/{children.length}
        </span>
      }
    >
      <IssueLinkList issues={children} hrefFor={(row) => pageHref(filters, row.id)} />
    </Section>
  )
}
