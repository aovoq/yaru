import type { ComponentChildren } from "preact"
import { FOCUS_RING } from "./focus-ring"
import { CrossIcon } from "./icons/cross-icon"

// 押して絞り込みを切り替える札
// pill はスマホ幅の状態の切り替え (mobile-status-nav.tsx) で、選んでいるものだけ面を塗る
// outline は見出しに並べる、いま掛かっている絞り込み (board/filter-chips.tsx) で、removable なら押すと外れることを × で示す
// 選んでいる札 (active) は塗りでしか分からないので、リンクなら aria-current で読み上げにも伝える https://www.w3.org/TR/wai-aria-1.2/#aria-current
// id はスマホ幅のダッシュボードへの入口 (#mobile-dashboard-link) のように、テストや CSS から 1 つを指したいときに渡す

export type ChipVariant = "pill" | "outline"

const VARIANTS: Record<ChipVariant, { base: string; active: string; inactive: string }> = {
  pill: {
    base: "rounded-full px-2.5",
    active: "bg-surface-2 text-ink",
    inactive: "text-ink-subtle hover:text-ink",
  },
  outline: {
    base: "rounded-md border bg-surface-1 pr-1.5 pl-2",
    active: "border-hairline-strong text-ink",
    inactive: "border-hairline text-ink-muted hover:border-hairline-strong",
  },
}

export function Chip({
  id,
  href,
  active = false,
  variant = "pill",
  icon,
  removable = false,
  class: extra = "",
  children,
}: {
  id?: string
  href?: string
  active?: boolean
  variant?: ChipVariant
  icon?: ComponentChildren
  removable?: boolean
  class?: string
  children?: ComponentChildren
}) {
  const style = VARIANTS[variant]
  const className = [
    "inline-flex h-6 shrink-0 items-center gap-1.5 text-xs no-underline transition-colors",
    style.base,
    active ? style.active : style.inactive,
    href !== undefined ? FOCUS_RING : "",
    extra,
  ]
    .filter(Boolean)
    .join(" ")
  const content = (
    <>
      {icon}
      {children}
      {removable ? <CrossIcon /> : null}
    </>
  )
  if (href !== undefined) {
    return (
      <a id={id} href={href} aria-current={active ? "page" : undefined} class={className}>
        {content}
      </a>
    )
  }
  return (
    <span id={id} class={className}>
      {content}
    </span>
  )
}
