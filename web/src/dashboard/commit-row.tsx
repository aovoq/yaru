import { RelativeTime } from "../components/relative-time"
import type { RepositoryCommit } from "../domain/repository"

// dashboard のコミットの 1 行。まだ送っていないコミットは点を primary にする。src/dashboard/commit-row.tsx

export function CommitRow({ commit, now }: { commit: RepositoryCommit; now: Date }) {
  return (
    <li
      data-pushed={commit.pushed === null ? undefined : String(commit.pushed)}
      class="flex items-baseline gap-2 px-3 py-2"
    >
      <span
        class={`size-1.5 shrink-0 self-center rounded-full ${
          commit.pushed === false ? "bg-primary-hover" : "bg-hairline-strong"
        }`}
      />
      <span class="min-w-0 flex-1 text-[13px] text-ink">{commit.subject}</span>
      <RelativeTime
        at={commit.committedAt}
        now={now}
        class="shrink-0 text-[11px] text-ink-tertiary"
      />
    </li>
  )
}
