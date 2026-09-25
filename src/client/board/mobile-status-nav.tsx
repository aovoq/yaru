import { STATUSES } from "../../store"
import { Chip } from "../../components/chip"
import { QuestionIcon } from "../../components/icons/question-icon"
import { StatusIcon } from "../../components/icons/status-icon"
import { pageHref, statusLabel, type PageFilters } from "../view-model"

// スマホ幅で左の絞り込みの代わりに出す、横に流れる状態の切り替えとダッシュボードへの入口

export function MobileStatusNav({
  filters,
  awaitingQuestionCount,
}: {
  filters: PageFilters
  awaitingQuestionCount: number
}) {
  return (
    <div class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline px-3 py-1.5 md:hidden">
      <Chip href={pageHref({ ...filters, status: undefined })} active={!filters.status}>
        All
      </Chip>
      {STATUSES.map((status) => (
        <Chip
          href={pageHref({ ...filters, status: filters.status === status ? undefined : status })}
          active={filters.status === status}
          icon={<StatusIcon status={status} />}
        >
          {statusLabel(status)}
        </Chip>
      ))}
      <Chip
        id="mobile-dashboard-link"
        href={`${filters.basePath ?? ""}/dashboard`}
        icon={<QuestionIcon />}
      >
        Dashboard
        <span class="text-ink-tertiary tabular-nums">{awaitingQuestionCount}</span>
      </Chip>
    </div>
  )
}
