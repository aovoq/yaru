import type { ComponentChildren } from "preact"

// StatTile を並べる格子。スマホ幅では 2 列、それより広ければ 4 列にする。dashboard の件数とセッションの数字で使う

export function StatGrid({ children }: { children?: ComponentChildren }) {
  return <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>
}
