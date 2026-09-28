import type { ComponentChildren } from "preact"

// 画面の上端に置く高さ 48px の帯。板・issue 画面・dashboard・プロジェクトの一覧で使う
// sticky は画面ごと縦に流れる dashboard とプロジェクトの一覧で、流しても帯を上に残し、下の中身を透かして見せる

const GAPS = {
  2: "gap-2",
  3: "gap-3",
} as const

export function HeaderBar({
  sticky = false,
  gap = 2,
  class: extra = "",
  children,
}: {
  sticky?: boolean
  gap?: keyof typeof GAPS
  class?: string
  children?: ComponentChildren
}) {
  return (
    <header
      class={[
        "flex h-12 shrink-0 items-center border-b border-hairline px-4",
        GAPS[gap],
        sticky ? "sticky top-0 z-10 bg-canvas/90 backdrop-blur" : "",
        extra,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </header>
  )
}
