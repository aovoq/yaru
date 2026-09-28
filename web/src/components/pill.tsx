import type { ComponentChildren, JSX } from "preact"

// 丸い枠の小さな札。ラベル、dashboard の「まだ送っていないコミット」や「更新があった」の知らせで使う
// 押せない表示だけの札。押して何かするものは Chip を使う

export type PillTone = "neutral" | "primary" | "danger"

const TONES: Record<PillTone, string> = {
  neutral: "border-hairline text-ink-subtle",
  primary: "border-primary/50 text-primary-hover",
  danger: "border-semantic-danger/40 text-semantic-danger",
}

// tone を null にすると色を付けず、呼ぶ側が class で色を決める (優先度の札など、色が tone の 3 種に収まらないとき)
export function Pill({
  tone = "neutral",
  class: extra = "",
  children,
  ...rest
}: {
  tone?: PillTone | null
  class?: string
  children?: ComponentChildren
} & Omit<JSX.HTMLAttributes<HTMLSpanElement>, "class" | "children">) {
  return (
    <span
      {...rest}
      class={[
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-[11px] leading-4",
        tone ? TONES[tone] : "",
        extra,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  )
}
