import {
  LOGO_COLOR,
  LOGO_CORNER_RADIUS,
  LOGO_GLYPH_COLOR,
  LOGO_GLYPH_PATH,
  LOGO_GLYPH_STROKE_WIDTH,
  LOGO_VIEW_BOX,
} from "../logo"
import type { Priority } from "../store"

export function StatusIcon({ status }: { status: string }) {
  if (status === "backlog")
    return (
      <svg class="size-3.5 shrink-0 text-ink-tertiary" viewBox="0 0 14 14" aria-hidden="true">
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
      <svg class="size-3.5 shrink-0 text-priority-medium" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M7 4.2 A2.8 2.8 0 0 1 7 9.8 Z" fill="currentColor" />
      </svg>
    )
  if (status === "done")
    return (
      <svg class="size-3.5 shrink-0 text-primary" viewBox="0 0 14 14" aria-hidden="true">
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
      <svg class="size-3.5 shrink-0 text-ink-tertiary" viewBox="0 0 14 14" aria-hidden="true">
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
    <svg class="size-3.5 shrink-0 text-ink-subtle" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
    </svg>
  )
}

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

export function AllIcon() {
  return (
    <svg class="size-3.5 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2 3.5h10M2 7h10M2 10.5h6.5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

export function BoardIcon() {
  return (
    <svg class="size-3.5" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1.5" y="2" width="4.5" height="10" rx="1.5" fill="currentColor" />
      <rect x="8" y="2" width="4.5" height="6.5" rx="1.5" fill="currentColor" />
    </svg>
  )
}

export function ListIcon() {
  return (
    <svg class="size-3.5" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2 3.5h10M2 7h10M2 10.5h10"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg class="size-3.5" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

export function SidebarIcon() {
  return (
    <svg class="size-3.5" viewBox="0 0 14 14" aria-hidden="true">
      <rect
        x="1.5"
        y="2"
        width="11"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <path d="M5.5 2v10" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

export function CrossIcon() {
  return (
    <svg class="size-3" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3.5 3.5l7 7M10.5 3.5l-7 7"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

export function ChevronIcon() {
  return (
    <svg class="size-3" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3.5 5.5L7 9l3.5-3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg
      class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-tertiary"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <circle cx="6.2" cy="6.2" r="4" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M9.2 9.2L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

export function SearchIconLarge() {
  return (
    <svg class="size-4" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="6.2" cy="6.2" r="4" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M9.2 9.2L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

export function QuestionIcon() {
  return (
    <svg class="size-3.5 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M5.6 5.6a1.45 1.45 0 1 1 2.1 1.3c-.45.24-.7.55-.7 1.05"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
      <circle cx="7" cy="10" r=".75" fill="currentColor" />
    </svg>
  )
}

export function LogoMark() {
  return (
    <svg
      class="size-5 shrink-0"
      viewBox={`0 0 ${LOGO_VIEW_BOX} ${LOGO_VIEW_BOX}`}
      aria-hidden="true"
    >
      <rect
        width={LOGO_VIEW_BOX}
        height={LOGO_VIEW_BOX}
        rx={LOGO_CORNER_RADIUS}
        fill={LOGO_COLOR}
      />
      <path
        d={LOGO_GLYPH_PATH}
        fill="none"
        stroke={LOGO_GLYPH_COLOR}
        stroke-width={LOGO_GLYPH_STROKE_WIDTH}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

// ホーム画面から開くとブラウザの戻るボタンが無いので、ロゴから全ワークスペースの一覧へ戻れるようにする
export function LogoLink({ class: className = "" }: { class?: string }) {
  return (
    <a
      href="/"
      aria-label="Projects"
      title="Projects"
      class={`shrink-0 rounded-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus/50 ${className}`}
    >
      <LogoMark />
    </a>
  )
}
