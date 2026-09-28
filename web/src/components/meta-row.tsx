import type { ComponentChildren } from "preact"

// 題名の下に小さく添える補足の並び (時刻・件数・パスなど)。折り返しても行と行が詰まりすぎないよう縦にも間を空ける
// dashboard のセッションの一覧とプロジェクトの一覧で使う

export function MetaRow({
  class: extra = "",
  children,
}: {
  class?: string
  children?: ComponentChildren
}) {
  return (
    <div
      class={["flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-tertiary", extra]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  )
}
