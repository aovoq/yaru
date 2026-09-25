import { IconButton } from "../../components/icon-button"
import { PlusIcon } from "../../components/icons/plus-icon"
import { IssueLinkList } from "../../components/issue-link-list"
import { ProgressBar } from "../../components/progress-bar"
import { Section } from "../../components/section"
import type { Issue } from "../../store"
import { newIssueHref, pageHref, type PageFilters } from "../view-model"

// issue 画面の子 issue の一覧。見出しの右に、終わった数の割合を棒と「1/2」の数で見せ、子 issue を足すボタン (+) を置く
// + はこの issue を親にした新しい issue の画面へのリンク。子 issue がまだ無くても足せるよう、見出しは常に出す

export function SubIssues({
  issue,
  all,
  filters,
  now,
}: {
  issue: Issue
  all: Issue[]
  filters: PageFilters
  now: Date
}) {
  const children = all.filter((other) => other.parent === issue.id)
  const done = children.filter((child) => child.status === "done").length
  return (
    <Section
      title="Sub-issues"
      aside={
        <span class="flex items-center gap-2 text-micro text-ink-tertiary tabular-nums">
          {children.length > 0 ? (
            <>
              <ProgressBar value={done} max={children.length} label="Sub-issues done" />
              <span aria-hidden="true">
                {done}/{children.length}
              </span>
            </>
          ) : null}
          <IconButton label="Add sub-issue" href={newIssueHref(filters, undefined, issue.id)}>
            <PlusIcon />
          </IconButton>
        </span>
      }
    >
      {children.length > 0 ? (
        <IssueLinkList issues={children} hrefFor={(row) => pageHref(filters, row.id)} now={now} />
      ) : null}
    </Section>
  )
}
