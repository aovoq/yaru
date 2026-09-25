import type { AwaitingSummary } from "../../page"
import type { Issue } from "../../store"
import { Avatar } from "../../components/avatar"
import { DueStamp } from "../../components/due-stamp"
import { FOCUS_RING } from "../../components/focus-ring"
import { IssueId } from "../../components/issue-id"
import { PriorityIcon } from "../../components/icons/priority-icon"
import { StatusIcon } from "../../components/icons/status-icon"
import { LabelChip } from "../../components/label-chip"
import { useIssueActions } from "../context-menu/issue-actions"
import { pageHref, type PageFilters } from "../view-model"
import { AwaitingBadge } from "./awaiting-badge"
import { BulkCheckbox } from "./bulk-checkbox"
import { StaleMarker } from "../../components/stale-marker"

// 板の列に並べる issue の 1 枚。押すと issue を開き、引きずると別の列へ移せる
// 右クリックのメニュー (data-id) と、j / k で選んだ印 (aria-selected) もこの要素に付ける
// 選んだカードは一覧の行 (issue-row.tsx) と同じく、左端の 2px の primary の帯と一段明るい面で示す
// 列が状態でないとき (優先度やラベルで分けたとき) は、落としても状態しか変えられないので引きずれなくし、状態のアイコンをカードに出す
// Card は a として描けないので、枠と面のクラスはここで持つ
// まとめて選んだカード (data-bulk-selected) は primary を薄く敷き、枠も primary にする
// まとめて選ぶ印 (BulkCheckbox) は右上の角に重ねる。担当者の顔と同じ場所なので、印がいつも出ているとき (何かを選んでいる間と指の端末) は
// 上の行の右に印の幅を空けて顔を左へ寄せ、マウスで乗ったときだけ出るときは顔を隠して印を見せる

export function IssueCard({
  issue,
  filters,
  selected,
  draggable,
  showStatus,
  awaiting,
  labelColors,
  now,
  onDragStart,
  onDragEnd,
}: {
  issue: Issue
  filters: PageFilters
  selected: boolean
  draggable: boolean
  showStatus: boolean
  awaiting?: AwaitingSummary
  labelColors: Map<string, string>
  now: Date
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
}) {
  const { bulkSelection } = useIssueActions()
  const selecting = bulkSelection.length > 0
  const bulkSelected = bulkSelection.includes(issue.id)
  return (
    <div class="group/item relative mb-2">
      <BulkCheckbox issueId={issue.id} class="top-1.5 right-1.5" />
      <a
        href={pageHref(filters, issue.id)}
        data-id={issue.id}
        data-status={issue.status}
        data-bulk-selected={bulkSelected ? "" : undefined}
        draggable={draggable}
        aria-selected={selected ? "true" : undefined}
        onDragStart={draggable ? onDragStart : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        class={`block cursor-pointer rounded-lg border border-hairline bg-surface-2 p-3 text-ink no-underline shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.03)] transition-colors select-none hover:border-hairline-strong hover:bg-surface-3 aria-selected:border-primary/60 aria-selected:bg-surface-3 aria-selected:shadow-[inset_2px_0_0_0_var(--color-primary)] data-[bulk-selected]:border-primary/60 data-[bulk-selected]:bg-primary/15 ${FOCUS_RING}`}
      >
        <div class={`flex items-center gap-2 ${selecting ? "pr-6" : "[@media(hover:none)]:pr-6"}`}>
          {showStatus ? <StatusIcon status={issue.status} /> : null}
          <IssueId id={issue.id} />
          {awaiting ? <AwaitingBadge summary={awaiting} now={now} /> : null}
          {issue.stale ? <StaleMarker /> : null}
          <span class={`ml-auto ${selecting ? "" : "group-hover/item:invisible"}`}>
            {issue.assignee ? <Avatar name={issue.assignee} /> : null}
          </span>
        </div>
        <div class="text-body mt-1 line-clamp-2 leading-snug font-medium tracking-tight text-ink">
          {issue.title}
        </div>
        {issue.priority || issue.dueDate || issue.labels.length > 0 ? (
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <PriorityIcon priority={issue.priority} />
            <DueStamp date={issue.dueDate} status={issue.status} now={now} />
            {issue.labels.map((label) => (
              <LabelChip label={label} color={labelColors.get(label)} />
            ))}
          </div>
        ) : null}
      </a>
    </div>
  )
}
