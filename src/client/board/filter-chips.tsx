import type { ComponentChildren } from "preact"
import { Avatar } from "../../components/avatar"
import { Chip } from "../../components/chip"
import { LabelDot } from "../../components/label-dot"
import { pageHref, type PageFilters } from "../view-model"

// 見出しの帯に、ラベルと担当者の絞り込みを押すと外れる札として並べる。状態と検索語は別の場所で見せるので含めない

export function FilterChips({ filters }: { filters: PageFilters }) {
  const chips: { icon: ComponentChildren; text: string; href: string }[] = []
  if (filters.label)
    chips.push({
      icon: <LabelDot label={filters.label} />,
      text: filters.label,
      href: pageHref({ ...filters, label: undefined }),
    })
  if (filters.assignee)
    chips.push({
      icon: <Avatar name={filters.assignee} />,
      text: filters.assignee,
      href: pageHref({ ...filters, assignee: undefined }),
    })
  if (chips.length === 0) return null
  return (
    <div class="hidden min-w-0 items-center gap-1.5 overflow-hidden lg:flex">
      {chips.map((chip) => (
        <Chip href={chip.href} variant="outline" icon={chip.icon} removable>
          {chip.text}
        </Chip>
      ))}
    </div>
  )
}
