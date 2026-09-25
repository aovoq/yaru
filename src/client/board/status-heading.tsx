import type { ComponentChildren } from "preact"
import { StatusIcon } from "../../components/icons/status-icon"
import { statusLabel } from "../view-model"

// 状態ごとのまとまりの見出し。状態のアイコン・名前・件数を横に並べる。板の列 (board-column.tsx) と一覧 (list-view.tsx) で使う
// 帯の高さや背景は置く場所ごとに違うので class で渡し、列の + のような右端の操作は children で足す

export function StatusHeading({
  status,
  count,
  class: extra = "",
  children,
}: {
  status: string
  count: number
  class?: string
  children?: ComponentChildren
}) {
  return (
    <div class={["flex items-center gap-2", extra].filter(Boolean).join(" ")}>
      <StatusIcon status={status} />
      <h2 class="text-[13px] font-medium tracking-tight text-ink">{statusLabel(status)}</h2>
      <span class="text-xs text-ink-tertiary tabular-nums">{count}</span>
      {children}
    </div>
  )
}
