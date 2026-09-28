import type { ComponentChildren } from "preact"

// dashboard・受信箱・プロジェクトの一覧の外枠。src/ui/page-shell.tsx
// 高さは dvh。100vh はスマホのツールバーを畳んだときの高さなので、下端が隠れる
// https://drafts.csswg.org/css-values-4/#viewport-variants
// #q-8 のように帯の下へ飛んだとき、飛んだ先が固定した帯に隠れないよう scroll-padding を取る
// https://drafts.csswg.org/css-scroll-snap-1/#scroll-padding

export function PageShell({
  sidebar,
  header,
  mainClass = "gap-8",
  children,
}: {
  sidebar?: ComponentChildren
  header: ComponentChildren
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
