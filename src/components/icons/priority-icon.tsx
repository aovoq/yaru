import type { JSX } from "preact"
import type { Priority } from "../../store"

// issue の優先度を表すアイコン。urgent だけを色で目立たせ、ほかは棒の本数で示す
// 優先度が無い issue は 3 本の短い線で描く。何も描かないと一覧の列がずれ、「無い」のか「読み込めていない」のかも分からないため
// 既定では role="img" と aria-label で優先度を読み上げる。すぐ隣に優先度の文字があるとき (メニューの項目、属性の欄) は
// decorative にして読み上げから外す。同じ言葉が 2 度読まれてしまうため
// https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/

const LABELS: Record<Priority, string> = {
  urgent: "Urgent priority",
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
}

// 灯っていない棒の濃さ。灯った棒との差をはっきりさせるため薄くする
const UNLIT_OPACITY = "0.2"

export function PriorityIcon({
  priority,
  decorative = false,
}: {
  priority: Priority | null
  decorative?: boolean
}) {
  const accessibility: JSX.SVGAttributes<SVGSVGElement> = decorative
    ? { "aria-hidden": "true" }
    : { role: "img", "aria-label": priority ? LABELS[priority] : "No priority" }
  if (!priority)
    return (
      <svg
        data-priority="none"
        class="size-3.5 shrink-0 text-ink-tertiary"
        viewBox="0 0 14 14"
        {...accessibility}
      >
        <path
          d="M1.5 7h2M6 7h2M10.5 7h2"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    )
  if (priority === "urgent")
    return (
      <svg
        data-priority="urgent"
        class="size-3.5 shrink-0 text-priority-urgent"
        viewBox="0 0 14 14"
        {...accessibility}
      >
        <rect x="0.5" y="0.5" width="13" height="13" rx="3.5" fill="currentColor" />
        <path
          d="M7 3.6v4.1"
          stroke="var(--color-canvas)"
          stroke-width="1.7"
          stroke-linecap="round"
        />
        <circle cx="7" cy="10.3" r="1" fill="var(--color-canvas)" />
      </svg>
    )
  const lit = { high: 3, medium: 2, low: 1 }[priority]
  return (
    <svg
      data-priority={priority}
      class="size-3.5 shrink-0 text-ink-muted"
      viewBox="0 0 14 14"
      {...accessibility}
    >
      <rect x="1" y="8" width="3" height="5" rx="1" fill="currentColor" />
      <rect
        x="5.5"
        y="5"
        width="3"
        height="8"
        rx="1"
        fill="currentColor"
        fill-opacity={lit >= 2 ? "1" : UNLIT_OPACITY}
      />
      <rect
        x="10"
        y="2"
        width="3"
        height="11"
        rx="1"
        fill="currentColor"
        fill-opacity={lit >= 3 ? "1" : UNLIT_OPACITY}
      />
    </svg>
  )
}
