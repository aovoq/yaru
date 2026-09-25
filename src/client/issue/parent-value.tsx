import { Button } from "../../components/button"
import { IssueId } from "../../components/issue-id"
import { StatusIcon } from "../../components/icons/status-icon"
import type { Issue } from "../../store"
import { pageHref, type PageFilters } from "../view-model"
import { PropertyPicker } from "./property-picker"
import { PropertyValueButton } from "./property-value-button"
import { descendantIds, issueOptions, NO_VALUE } from "./property-options"

// 属性欄の親。親があれば番号と題名をリンクにして親へ移れるようにし、変えるボタン (Edit) は右に置く
// Edit はマウスでは行に hover したときと focus したとき (面を開いている間を含む) だけ出し、指で操作する画面では常に出す。指では hover が無いため
// 題名は欄の幅で切れるので、hover で全文を読めるよう title にも入れる
// 親が見つからない番号 (消された issue など) は番号だけを出す

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
      {/* Edit は題名に重ねて右端に置き、隠れている間も題名の幅を削らない */}
      <span class="absolute inset-y-0 right-0 flex items-center bg-canvas pl-1 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-within:opacity-100">
        {picker}
      </span>
    </span>
  )
}
