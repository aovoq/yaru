import type { Issue } from "../domain/issue"
import { currentTime } from "../domain/time"
import { PriorityIcon } from "./icons/priority-icon"
import { StatusIcon } from "./icons/status-icon"
import { Avatar } from "./avatar"
import { DueStamp } from "./due-stamp"
import { IssueId } from "./issue-id"
import { StaleMarker } from "./stale-marker"

// issue の行を並べた一覧。行を押すとその issue を開き、右クリックのメニューも開ける (data-id)
// 子 issue・関係・dashboard の作業中や期限切れなど、issue を数件並べる場所で共通に使う
// 優先度・番号・状態・期日・担当者は、値が無い行でも同じ幅の枠 (data-slot) を置き、行をまたいで列を縦にそろえる
// 終わった (done・canceled) issue は題名を薄くし、data-finished を付ける。期日を過ぎていても期限切れの色にはしない
// showStale は dashboard の作業中の一覧のように、進行中のまま止まっている issue (Issue.stale) に札を付けて気づかせたい場所で使う
// 一覧は枠の中で端まで広がり、外に出る focus の枠は切れてしまうので、内側に引いた枠を使う

const FINISHED_STATUSES = ["done", "canceled"]

export function IssueLinkList({
  issues,
  hrefFor,
  showDueDate = false,
  showStale = false,
  now = currentTime(),
}: {
  issues: Issue[]
  hrefFor: (issue: Issue) => string
  showDueDate?: boolean
  showStale?: boolean
  now?: Date
}) {
  return (
    <ul class="flex flex-col overflow-hidden rounded-lg border border-hairline bg-surface-1">
      {issues.map((issue) => {
        const finished = FINISHED_STATUSES.includes(issue.status)
        return (
          <li key={issue.id} class="border-b border-hairline/60 last:border-b-0">
            <a
              href={hrefFor(issue)}
              data-id={issue.id}
              data-finished={finished ? "" : undefined}
              class="flex min-h-9 items-center gap-2.5 px-3 py-1.5 no-underline transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-hover"
            >
              <span data-slot="priority" class="grid w-4 shrink-0 place-items-center">
                <PriorityIcon priority={issue.priority} />
              </span>
              <IssueId id={issue.id} class="w-10" />
              <span data-slot="status" class="grid w-4 shrink-0 place-items-center">
                <StatusIcon status={issue.status} />
              </span>
              <span
                class={`text-body min-w-0 flex-1 truncate ${finished ? "text-ink-subtle" : "text-ink"}`}
              >
                {issue.title}
              </span>
              {showStale && issue.stale ? <StaleMarker /> : null}
              {showDueDate ? (
                <span data-slot="due" class="w-20 shrink-0 text-right">
                  <DueStamp date={issue.dueDate} status={issue.status} now={now} />
                </span>
              ) : null}
              <span data-slot="assignee" class="grid w-[18px] shrink-0 place-items-center">
                {issue.assignee ? <Avatar name={issue.assignee} /> : null}
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}
