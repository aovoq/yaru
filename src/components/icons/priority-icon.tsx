import type { Priority } from "../../store"

// issue の優先度を表すアイコン。優先度が無ければ何も描かない
export function PriorityIcon({ priority }: { priority: Priority | null }) {
  if (!priority) return null
  if (priority === "urgent")
    return (
      <svg
        data-priority="urgent"
        class="size-3.5 shrink-0 text-priority-urgent"
        viewBox="0 0 14 14"
        aria-hidden="true"
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
      class="size-3.5 shrink-0 text-ink-subtle"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="8"
        width="3"
        height="5"
        rx="1"
        fill="currentColor"
        fill-opacity={lit >= 1 ? "1" : "0.3"}
      />
      <rect
        x="5.5"
        y="5"
        width="3"
        height="8"
        rx="1"
        fill="currentColor"
        fill-opacity={lit >= 2 ? "1" : "0.3"}
      />
      <rect
        x="10"
        y="2"
        width="3"
        height="11"
        rx="1"
        fill="currentColor"
        fill-opacity={lit >= 3 ? "1" : "0.3"}
      />
    </svg>
  )
}
