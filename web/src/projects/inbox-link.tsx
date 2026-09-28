import { FOCUS_RING } from "../components/focus-ring"
import { ChevronRightIcon } from "../components/icons/chevron-right-icon"

// 一覧の先頭に置く、受信箱への入口。src/projects/inbox-link.tsx

export function InboxLink({ awaiting }: { awaiting: number }) {
  return (
    <a
      href="/inbox"
      class={`flex min-h-14 items-center gap-3 rounded-lg border border-hairline bg-surface-1 px-4 py-3 no-underline transition-colors hover:border-hairline-strong hover:bg-surface-2 ${FOCUS_RING}`}
    >
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-title font-medium text-ink">Inbox</span>
        <span class="text-small text-ink-subtle">
          Every workspace's questions, most urgent first
        </span>
      </span>
      <span
        class={`text-display font-semibold tabular-nums ${awaiting > 0 ? "text-primary-hover" : "text-ink-tertiary"}`}
      >
        {awaiting}
      </span>
      <ChevronRightIcon />
    </a>
  )
}
