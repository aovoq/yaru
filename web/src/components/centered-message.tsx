import type { ComponentChildren } from "preact"
import { IconTile } from "./icon-tile"

// 画面の真ん中にアイコンと短い案内を縦に並べる。空の板 (EmptyBoard) とエラー画面 (ErrorView) で使う
// 目線の高さに来るよう、下に余白を足して少し上へ寄せる
// 一覧の中の小さな空の知らせには、点線の枠の EmptyState を使う

export function CenteredMessage({
  icon,
  children,
}: {
  icon: ComponentChildren
  children?: ComponentChildren
}) {
  return (
    <div class="flex flex-col items-center gap-3 pb-16 text-center">
      <IconTile>{icon}</IconTile>
      {children}
    </div>
  )
}
