import type { ComponentChildren } from "preact"

// キーボードの操作を示すキーの表記
// boxed は枠で囲んだ既定の見た目、plain は文中に溶け込ませる枠なし、on-primary は primary のボタンの上に置くとき
export type KbdVariant = "boxed" | "plain" | "on-primary"

const VARIANTS: Record<KbdVariant, string> = {
  boxed:
    "rounded-sm border border-hairline bg-surface-1 px-1 font-mono text-[10px] text-ink-tertiary",
  plain: "font-mono text-[11px] text-ink-tertiary",
  "on-primary": "font-mono text-[10px] text-on-primary/60",
}

export function Kbd({
  variant = "boxed",
  children,
}: {
  variant?: KbdVariant
  children?: ComponentChildren
}) {
  return <kbd class={VARIANTS[variant]}>{children}</kbd>
}
