import type { ComponentChildren } from "preact"

// まとまりの前に置く小さな見出し。サイドバーの「Status」「Labels」「People」と、issue 画面の「Properties」で使う
// 上下左右の間は置く場所ごとに違うので class で渡す

export function GroupLabel({
  class: extra = "",
  children,
}: {
  class?: string
  children?: ComponentChildren
}) {
  return (
    <div class={["text-[11px] font-medium text-ink-tertiary", extra].filter(Boolean).join(" ")}>
      {children}
    </div>
  )
}
