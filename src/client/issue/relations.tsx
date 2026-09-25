import { IssueLinkList } from "../../components/issue-link-list"
import { Section } from "../../components/section"
import type { Issue } from "../../store"
import { pageHref, type PageFilters } from "../view-model"

// issue 画面で、つながりのある issue (子 issue・止めている / 止められている issue) を並べる

// 子 issue の一覧。見出しの右に、終わった数の割合を棒で見せる
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
          <span class="h-1 w-16 overflow-hidden rounded-full bg-surface-3">
            <span
              class="block h-full rounded-full bg-primary"
              style={`width: ${Math.round((done / children.length) * 100)}%`}
            />
          </span>
          {done}/{children.length}
        </span>
      }
    >
      <IssueLinkList issues={children} hrefFor={(row) => pageHref(filters, row.id)} />
    </Section>
  )
}

// この issue を止めている issue と、この issue が止めている issue。どちらも無ければ何も出さない
export function Relations({
  issue,
  all,
  filters,
}: {
  issue: Issue
  all: Issue[]
  filters: PageFilters
}) {
  const byId = new Map(all.map((other) => [other.id, other]))
  const blockedBy = issue.blockedBy.map((id) => byId.get(id)).filter((row) => row !== undefined)
  const blocks = issue.blocks.map((id) => byId.get(id)).filter((row) => row !== undefined)
  if (blockedBy.length === 0 && blocks.length === 0) return null
  const hrefFor = (row: Issue) => pageHref(filters, row.id)
  return (
    <>
      {blockedBy.length > 0 ? (
        <Section title="Blocked by">
          <IssueLinkList issues={blockedBy} hrefFor={hrefFor} />
        </Section>
      ) : null}
      {blocks.length > 0 ? (
        <Section title="Blocks">
          <IssueLinkList issues={blocks} hrefFor={hrefFor} />
        </Section>
      ) : null}
    </>
  )
}
