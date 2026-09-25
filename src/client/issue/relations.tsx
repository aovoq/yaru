import { IssueLinkList } from "../../components/issue-link-list"
import { Section } from "../../components/section"
import type { Issue } from "../../store"
import { pageHref, type PageFilters } from "../view-model"

// issue 画面で、この issue を止めている issue と、この issue が止めている issue を並べる
// どちらも無ければ何も出さない。子 issue の一覧は sub-issues.tsx にある

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
