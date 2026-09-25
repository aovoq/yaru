import { STATUSES } from "../../store"
import { QuestionIcon, StatusIcon } from "../../components/icons"
import { pageHref, statusLabel, type PageFilters } from "../view-model"

// スマホ幅で左の絞り込みの代わりに出す、横に流れる状態の切り替えとダッシュボードへの入口

export function MobileStatusNav({
  filters,
  awaitingQuestionCount,
}: {
  filters: PageFilters
  awaitingQuestionCount: number
}) {
  const pill = (active: boolean) =>
    `inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs no-underline transition-colors ${
      active ? "bg-surface-2 text-ink" : "text-ink-subtle hover:text-ink"
    }`
  return (
    <div class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline px-3 py-1.5 md:hidden">
      <a href={pageHref({ ...filters, status: undefined })} class={pill(!filters.status)}>
        All
      </a>
      {STATUSES.map((status) => (
        <a
          href={pageHref({ ...filters, status: filters.status === status ? undefined : status })}
          class={pill(filters.status === status)}
        >
          <StatusIcon status={status} />
          {statusLabel(status)}
        </a>
      ))}
      <a
        id="mobile-dashboard-link"
        href={`${filters.basePath ?? ""}/dashboard`}
        class={pill(false)}
      >
        <QuestionIcon />
        Dashboard
        <span class="text-ink-tertiary tabular-nums">{awaitingQuestionCount}</span>
      </a>
    </div>
  )
}
