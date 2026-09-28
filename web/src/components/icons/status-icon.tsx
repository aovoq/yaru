import type { JSX } from "preact"

// issue の状態 (backlog・todo・in_progress・done・canceled) を表すアイコン
// 既定では role="img" と aria-label で状態の名前を読み上げる。形と色だけでは読み上げでも色の見分けにくい人にも伝わらないため
// すぐ隣に状態の名前があるとき (メニューの項目、列の見出し、属性の欄) は decorative にして読み上げから外す。同じ言葉が 2 度読まれてしまうため
// https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/

export function StatusIcon({
  status,
  decorative = false,
}: {
  status: string
  decorative?: boolean
}) {
  const accessibility: JSX.SVGAttributes<SVGSVGElement> = decorative
    ? { "aria-hidden": "true" }
    : { role: "img", "aria-label": statusName(status) }
  if (status === "backlog")
    return (
      <svg class="size-3.5 shrink-0 text-ink-tertiary" viewBox="0 0 14 14" {...accessibility}>
        <circle
          cx="7"
          cy="7"
          r="5.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-dasharray="1.8 1.9"
        />
      </svg>
    )
  if (status === "in_progress")
    return (
      <svg class="size-3.5 shrink-0 text-priority-medium" viewBox="0 0 14 14" {...accessibility}>
        <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M7 4.2 A2.8 2.8 0 0 1 7 9.8 Z" fill="currentColor" />
      </svg>
    )
  if (status === "done")
    return (
      <svg class="size-3.5 shrink-0 text-primary" viewBox="0 0 14 14" {...accessibility}>
        <circle cx="7" cy="7" r="6.4" fill="currentColor" />
        <path
          d="M4.2 7.2l1.9 1.9 3.7-4.1"
          fill="none"
          stroke="var(--color-canvas)"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    )
  if (status === "canceled")
    return (
      <svg class="size-3.5 shrink-0 text-ink-tertiary" viewBox="0 0 14 14" {...accessibility}>
        <circle cx="7" cy="7" r="6.4" fill="currentColor" />
        <path
          d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4"
          stroke="var(--color-canvas)"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    )
  return (
    <svg class="size-3.5 shrink-0 text-ink-subtle" viewBox="0 0 14 14" {...accessibility}>
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
    </svg>
  )
}

// 状態の名前。板の列の見出し (client/view-model.ts の statusLabel) と同じく、_ を空白にして語頭を大文字にする
function statusName(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}
