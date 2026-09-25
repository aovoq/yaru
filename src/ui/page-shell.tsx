import type { ComponentChildren } from "preact"

// サーバーで描く画面 (dashboard・/inbox・プロジェクトの一覧) の外枠。板と同じく、md 以上の幅では左にサイドバー、右に中身を並べる
// スマホ幅ではサイドバーを隠し (Sidebar 自身が md:flex)、中身を 1 列で縦に流して、見出しの帯 (header) を上に残す
// 高さは dvh で決める。100vh はスマホのツールバーを畳んだときの高さなので、下端が隠れるため
// https://drafts.csswg.org/css-values-4/#viewport-variants
// #q-8 のように帯の下へ飛んだとき、飛んだ先が固定した帯に隠れないよう、流れる枠に scroll-padding を取る
// https://drafts.csswg.org/css-scroll-snap-1/#scroll-padding
// 流れる枠は relative にする。読み上げ用の sr-only (absolute) の親に位置を持つ要素が無いと、枠の外の html に置かれて、
// body の overflow-hidden を越えて画面全体が縦に流れ、サイドバーごとずれてしまうため

export function PageShell({
  sidebar,
  header,
  mainClass = "gap-8",
  children,
}: {
  // md 以上で左に置くサイドバー。全ワークスペースにまたがる画面 (一覧・/inbox) では渡さない
  sidebar?: ComponentChildren
  header: ComponentChildren
  // 中身のまとまりの間など、画面ごとに違う並べ方
  mainClass?: string
  children?: ComponentChildren
}) {
  return (
    <div class="flex h-dvh">
      {sidebar}
      <div class="relative min-w-0 flex-1 scroll-pt-16 overflow-y-auto">
        <div class="sticky top-0 z-10 bg-canvas/90 pt-safe backdrop-blur">{header}</div>
        <main
          class={`mx-auto flex max-w-2xl flex-col px-4 pt-4 pb-[calc(4rem+env(safe-area-inset-bottom))] ${mainClass}`}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
