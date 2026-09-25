import type { ComponentChildren } from "preact"
import { FOCUS_RING } from "./focus-ring"

// 枠の中にアイコンのリンクを並べ、選んでいる 1 つだけを塗って見せる切り替え。板と一覧の表示の切り替え (board/header.tsx) で使う
// 切り替えは URL で持つので、各項目はリンクにする

export type SegmentedControlItem = {
  href: string
  title: string
  icon: ComponentChildren
  active: boolean
}

export function SegmentedControl({ items }: { items: SegmentedControlItem[] }) {
  return (
    <div class="flex shrink-0 items-center gap-0.5 rounded-md border border-hairline p-0.5">
      {items.map((item) => (
        <a
          href={item.href}
          title={item.title}
          class={`grid h-6 w-7 place-items-center rounded-[5px] no-underline transition-colors ${FOCUS_RING} ${
            item.active ? "bg-surface-3 text-ink" : "text-ink-tertiary hover:text-ink"
          }`}
        >
          {item.icon}
        </a>
      ))}
    </div>
  )
}
