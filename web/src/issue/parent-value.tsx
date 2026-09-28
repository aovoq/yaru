import { Button } from "../components/button"
import { IssueId } from "../components/issue-id"
import { StatusIcon } from "../components/icons/status-icon"
import type { Issue } from "../domain/issue"
import { pageHref } from "./filters"
import type { PageFilters } from "./model"
import { PropertyPicker } from "./property-picker"
import { PropertyValueButton } from "./property-value-button"
import { descendantIds, issueOptions, NO_VALUE } from "./property-options"

// 属性欄の親。親があれば番号と題名をリンクにし、変えるボタンは右に置く
// Edit はマウスでは hover と focus のときだけ出し、指の画面では常に出す

export function ParentValue({
  issue,
  all,
  filters,
  labelledBy,
  onCommit,
}: {
  issue: Issue
  all: Issue[]
  filters: PageFilters
  labelledBy: string
  onCommit: (value: string) => void
}) {
  const parent = issue.parent ? all.find((row) => row.id === issue.parent) : undefined
  const options = [
    { value: NO_VALUE, label: "No parent" },
    ...issueOptions(all, issue.id ? descendantIds(all, issue.id) : new Set()),
  ]
  const picker = (
    <PropertyPicker
      label="Parent issue"
      placeholder="Search issues…"
      options={options}
      selected={[issue.parent ?? NO_VALUE]}
      align="end"
      onSelect={onCommit}
      trigger={(trigger) =>
        issue.parent ? (
          <Button {...trigger} variant="ghost" size="xs" aria-label="Change parent">
            Edit
          </Button>
        ) : (
          <PropertyValueButton trigger={trigger} labelledBy={labelledBy} empty>
            Set parent
          </PropertyValueButton>
        )
      }
    />
  )
  if (!issue.parent) return picker
  return (
    <span class="group relative flex h-7 min-w-0 items-center">
      <a
        href={pageHref(filters, issue.parent)}
        title={parent?.title}
        aria-labelledby={labelledBy}
        class="flex min-w-0 flex-1 items-center gap-1.5 rounded-xs px-2 text-body text-ink no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary-hover"
      >
        {parent ? <StatusIcon status={parent.status} decorative /> : null}
        <IssueId id={issue.parent} />
        {parent ? <span class="min-w-0 truncate">{parent.title}</span> : null}
      </a>
      <span class="absolute inset-y-0 right-0 flex items-center bg-canvas pl-1 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-within:opacity-100">
        {picker}
      </span>
    </span>
  )
}
