import type { ComponentChildren } from "preact"

// 行を細い線で区切って 1 つの枠に収める一覧。dashboard のコミットやセッションの一覧で使う
// 子には li を並べる。行の余白は li の側で決める

export function ListBox({
  class: extra = "",
  children,
}: {
  class?: string
  children?: ComponentChildren
}) {
  return (
    <ul
      class={[
        "flex flex-col divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface-1",
        extra,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </ul>
  )
}
