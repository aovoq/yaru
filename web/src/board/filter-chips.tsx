import type { ComponentChildren } from "preact"
import { Avatar } from "../components/avatar"
import { Chip } from "../components/chip"
import { ClockIcon } from "../components/icons/clock-icon"
import { LabelDot } from "../components/label-dot"
import { pageHref, type PageFilters } from "./view-model"

// いま掛かっている絞り込みを、押すと外れる札として並べる。状態は別の場所 (サイドバーとスマホ幅の状態の切り替え) で見せるので含めない
// 検索語はデスクトップ幅では検索欄に見えているので、検索欄を畳んでいるスマホ幅だけ札にする (includeQuery)
// 置く場所ごとに見せる幅と余白が違うので、並べる枠のクラスは class で渡す

export function FilterChips({
  filters,
  labelColors,
  includeQuery = false,
  class: extra = "",
}: {
  filters: PageFilters
  labelColors: Map<string, string>
  includeQuery?: boolean
  class?: string
}) {
  const chips: { icon?: ComponentChildren; text: string; label: string; href: string }[] = []
  if (includeQuery && filters.query)
    chips.push({
      text: `“${filters.query}”`,
      label: `Remove search ${filters.query}`,
      href: pageHref({ ...filters, query: undefined }),
    })
  if (filters.awaiting)
    chips.push({
      icon: <ClockIcon />,
      text: "Awaiting answer",
      label: "Remove awaiting answer filter",
      href: pageHref({ ...filters, awaiting: undefined }),
    })
  if (filters.label)
    chips.push({
      icon: <LabelDot label={filters.label} color={labelColors.get(filters.label)} />,
      text: filters.label,
      label: `Remove label ${filters.label}`,
      href: pageHref({ ...filters, label: undefined }),
    })
  if (filters.assignee)
    chips.push({
      icon: <Avatar name={filters.assignee} />,
      text: filters.assignee,
      label: `Remove assignee ${filters.assignee}`,
      href: pageHref({ ...filters, assignee: undefined }),
    })
  if (chips.length === 0) return null
  return (
    <div
      data-filter-chips=""
      class={["min-w-0 items-center gap-1.5", extra].filter(Boolean).join(" ")}
    >
      {chips.map((chip) => (
        <Chip href={chip.href} variant="outline" icon={chip.icon} removable>
          <span class="sr-only">{chip.label}</span>
          <span aria-hidden="true" class="max-w-40 truncate">
            {chip.text}
          </span>
        </Chip>
      ))}
    </div>
  )
}
