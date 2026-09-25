import type { ComponentChildren } from "preact"
import { FOCUS_RING } from "../../components/focus-ring"

// サイドバーの絞り込みの 1 行。アイコン・名前・件数を並べ、いま選んでいる絞り込みだけ面を塗る

export function NavItem({
  href,
  active,
  icon,
  label,
  count,
}: {
  href: string
  active: boolean
  icon: ComponentChildren
  label: string
  count: number
}) {
  return (
    <a
      href={href}
      class={`flex h-7 items-center gap-2 rounded-md px-2 no-underline transition-colors ${FOCUS_RING} ${
        active ? "bg-surface-2 text-ink" : "text-ink-subtle hover:bg-surface-1 hover:text-ink"
      }`}
    >
      {icon}
      <span class="min-w-0 flex-1 truncate text-[13px]">{label}</span>
      <span class="text-[11px] text-ink-tertiary tabular-nums">{count}</span>
    </a>
  )
}
