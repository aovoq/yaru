import { STATUSES } from "../domain/issue"
import { Chip } from "../components/chip"
import { StatusIcon } from "../components/icons/status-icon"
import { pageHref, statusLabel, type PageFilters } from "./view-model"
import { FilterChips } from "./filter-chips"

// スマホ幅で左の絞り込みの代わりに出す帯。いま掛かっている絞り込みを外せる札の行と、横に流れる状態の切り替えを持つ
// サイドバーが無いと、ラベルや担当者で絞り込んだまま外す手段も、絞り込まれていることも分からなくなるため、札の行を出す
// ダッシュボードへの入口は見出しの帯 (header.tsx) に置く

export function MobileStatusNav({
  filters,
  labelColors,
}: {
  filters: PageFilters
  labelColors: Map<string, string>
}) {
  return (
    <div class="shrink-0 border-b border-hairline md:hidden">
      <FilterChips
        filters={filters}
        labelColors={labelColors}
        includeQuery
        class="flex overflow-x-auto px-3 pt-2"
      />
      <div class="flex items-center gap-1 overflow-x-auto px-3 py-1.5">
        <Chip href={pageHref({ ...filters, status: undefined })} active={!filters.status}>
          All
        </Chip>
        {STATUSES.map((status) => (
          <Chip
            href={pageHref({ ...filters, status: filters.status === status ? undefined : status })}
            active={filters.status === status}
            icon={<StatusIcon status={status} decorative />}
          >
            {statusLabel(status)}
          </Chip>
        ))}
      </div>
    </div>
  )
}
