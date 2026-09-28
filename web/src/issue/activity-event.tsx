import type { ComponentChildren } from "preact"
import { RelativeTime } from "../components/relative-time"

// 活動欄の出来事を、軸の上のアイコンと小さな 1 文で示す

export function ActivityEvent({
  icon,
  children,
  at,
  now,
}: {
  icon: ComponentChildren
  children?: ComponentChildren
  at: string
  now: Date
}) {
  return (
    <li class="flex min-h-6 items-center gap-3 text-small text-ink-tertiary">
      <span class="relative grid size-[18px] shrink-0 place-items-center bg-canvas">{icon}</span>
      <span class="min-w-0">
        {children}
        <span class="mx-1.5" aria-hidden="true">
          ·
        </span>
        <RelativeTime at={at} now={now} />
      </span>
    </li>
  )
}
