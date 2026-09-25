import type { AwaitingSummary } from "../../page"
import type { Issue } from "../../store"
import { Avatar } from "../../components/avatar"
import { DueStamp } from "../../components/due-stamp"
import { IssueId } from "../../components/issue-id"
import { PriorityIcon } from "../../components/icons/priority-icon"
import { StatusIcon } from "../../components/icons/status-icon"
import { LabelChip } from "../../components/label-chip"
import { pageHref, primaryLabel, type PageFilters } from "../view-model"
import { AwaitingBadge } from "./awaiting-badge"
import { StaleMarker } from "./stale-marker"

// 一覧の表示の issue の 1 行。押すと issue を開く。右クリックのメニュー (data-id) と、j / k で選んだ印 (aria-selected) もここに付ける
// 選んだ行は左端の 2px の primary の帯と一段明るい面で示す。hover の面 (surface-1) と見分けられるようにするため
// 帯は枠ではなく内側の影で引き、選んでも行の中身が横にずれないようにする
// 行は画面の端まで広がり、外側に出る focus の枠は左右で切れてしまうので、FOCUS_RING ではなく内側に引いた枠を使う
// スマホ幅では期日とラベルの列を置けないので、題名の下の 2 行目に期日と代表のラベル (primaryLabel) を出す。期限切れを見落とさないよう期日は必ず出す

export function IssueRow({
  issue,
  filters,
  selected,
  awaiting,
  labelColors,
  now,
}: {
  issue: Issue
  filters: PageFilters
  selected: boolean
  awaiting?: AwaitingSummary
  labelColors: Map<string, string>
  now: Date
}) {
  const firstLabel = primaryLabel(issue)
  return (
    <a
      href={pageHref(filters, issue.id)}
      data-id={issue.id}
      data-status={issue.status}
      aria-selected={selected ? "true" : undefined}
      class="flex min-h-10 items-center gap-2 border-b border-hairline/60 px-4 py-2 text-ink no-underline transition-colors hover:bg-surface-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-hover aria-selected:bg-surface-3 aria-selected:shadow-[inset_2px_0_0_0_var(--color-primary)] sm:h-10 sm:gap-3 sm:py-0"
    >
      <span class="w-4 shrink-0">
        <PriorityIcon priority={issue.priority} />
      </span>
      <StatusIcon status={issue.status} />
      <IssueId id={issue.id} class="w-9" />
      <span class="min-w-0 flex-1">
        <span class="flex min-w-0 items-center gap-2">
          <span class="text-body min-w-0 truncate font-medium">{issue.title}</span>
          {awaiting ? <AwaitingBadge summary={awaiting} now={now} /> : null}
          {issue.stale ? <StaleMarker /> : null}
        </span>
        {issue.dueDate || firstLabel ? (
          <span data-row-meta="" class="mt-1 flex min-w-0 items-center gap-2 sm:hidden">
            <DueStamp date={issue.dueDate} status={issue.status} now={now} />
            {firstLabel ? (
              <LabelChip label={firstLabel} color={labelColors.get(firstLabel)} />
            ) : null}
          </span>
        ) : null}
      </span>
      <span class="hidden shrink-0 items-center gap-1.5 lg:flex">
        {issue.labels.map((label) => (
          <LabelChip label={label} color={labelColors.get(label)} />
        ))}
      </span>
      <span class="hidden w-20 shrink-0 text-right sm:inline">
        <DueStamp date={issue.dueDate} status={issue.status} now={now} />
      </span>
      <span class="w-[18px] shrink-0">
        {issue.assignee ? <Avatar name={issue.assignee} /> : null}
      </span>
    </a>
  )
}
