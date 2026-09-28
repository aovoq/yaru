import type { ComponentChildren } from "preact"

// キーボードの操作を示すキーの表記。J と K のように続けて押さないキーは、呼ぶ側で 1 つずつ Kbd に分ける
// boxed は枠で囲んだ既定の見た目、plain は文中に溶け込ませる枠なし、on-primary は primary のボタンの上に置くとき
// on-primary は白を薄めない。primary (#5e6ad2) の上で白は 4.7:1 だが、80% に薄めると 3.6:1 に落ちて 11px の字が読めない
// https://www.w3.org/TR/WCAG22/#contrast-minimum
export type KbdVariant = "boxed" | "plain" | "on-primary"

const VARIANTS: Record<KbdVariant, string> = {
  boxed:
    "rounded-xs border border-hairline bg-surface-1 px-1 py-0.5 font-mono text-micro leading-none text-ink-tertiary",
  plain: "font-mono text-micro text-ink-tertiary",
  "on-primary": "font-mono text-micro text-on-primary",
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
