import { IssueLinkList } from "../components/issue-link-list"
import { Section } from "../components/section"
import type { Issue } from "../domain/issue"
import { pageHref } from "./filters"
import type { PageFilters } from "./model"
import type { RelationKind } from "./relation-kind-switch"
import { RelationPicker } from "./relation-picker"

// この issue を止めている issue と、この issue が止めている issue を並べる

export function Relations({
  issue,
  all,
  filters,
  now,
  onToggle,
}: {
  issue: Issue
  all: Issue[]
  filters: PageFilters
  now: Date
  onToggle: (kind: RelationKind, otherId: string) => void
}) {
  const byId = new Map(all.map((other) => [other.id, other]))
  const blockedBy = issue.blockedBy.map((id) => byId.get(id)).filter((row) => row !== undefined)
  const blocks = issue.blocks.map((id) => byId.get(id)).filter((row) => row !== undefined)
  const hrefFor = (row: Issue) => pageHref(filters, row.id)
  return (
    <Section
      title="Relations"
      aside={<RelationPicker issue={issue} all={all} onToggle={onToggle} />}
    >
      {blockedBy.length > 0 ? (
        <div class="flex flex-col gap-1.5">
          <h3 class="text-small text-ink-tertiary">Blocked by</h3>
          <IssueLinkList issues={blockedBy} hrefFor={hrefFor} now={now} />
        </div>
      ) : null}
      {blocks.length > 0 ? (
        <div class="flex flex-col gap-1.5">
          <h3 class="text-small text-ink-tertiary">Blocks</h3>
          <IssueLinkList issues={blocks} hrefFor={hrefFor} now={now} />
        </div>
      ) : null}
    </Section>
  )
}
