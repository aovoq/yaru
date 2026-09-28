import type { ComponentChildren } from "preact"

// アイコンを角の丸い 40px の枠に収めて見せる。空の板やエラー画面の真ん中の案内 (CenteredMessage) で使う

export function IconTile({ children }: { children?: ComponentChildren }) {
  return (
    <span class="grid size-10 place-items-center rounded-xl border border-hairline bg-surface-1 text-ink-tertiary">
      {children}
    </span>
  )
}
