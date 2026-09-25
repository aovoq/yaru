import type { ComponentChildren } from "preact"
import { FOCUS_RING } from "../../components/focus-ring"

// サイドバーの絞り込みの 1 行。アイコン・名前・件数を並べ、いま選んでいる絞り込みだけ面を塗る
// 塗りは目でしか分からないので、選んでいるものは aria-current で読み上げにも伝える
// https://www.w3.org/TR/wai-aria-1.2/#aria-current

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
      aria-current={active ? "page" : undefined}
      class={`flex h-7 items-center gap-2 rounded-md px-2 no-underline transition-colors ${FOCUS_RING} ${
        active ? "bg-surface-2 text-ink" : "text-ink-subtle hover:bg-surface-1 hover:text-ink"
      }`}
    >
      {icon}
      <span class="text-body min-w-0 flex-1 truncate">{label}</span>
      <span class="text-micro text-ink-tertiary tabular-nums">{count}</span>
    </a>
  )
}
