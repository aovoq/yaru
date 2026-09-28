import type { ComponentChildren } from "preact"

// 一覧が空のときに、空であることを点線の枠で伝える

export function EmptyState({ children }: { children?: ComponentChildren }) {
  return (
    <p class="rounded-lg border border-dashed border-hairline px-3 py-4 text-center text-[13px] text-ink-tertiary">
      {children}
    </p>
  )
}
