import { EmptyState } from "../components/empty-state"
import type { RepositoryState } from "../repository"
import { relativeTime } from "../time"

// dashboard のコミットのまとまり。ブランチ、まだ送っていないコミット、書きかけのファイルを見出しの行にまとめて出す
// 見出しに状態の札を折り返して並べるため、components/section.tsx の Section ではなく専用の見出しを持つ

export function RepositorySection({ repository, now }: { repository: RepositoryState; now: Date }) {
  return (
    <section class="flex flex-col gap-3">
      <h2 class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-ink">
        Commits
        <span class="font-mono text-[11px] font-normal text-ink-subtle">
          {repository.branch ?? "detached HEAD"}
        </span>
        {repository.upstream === null ? (
          <span class="text-[11px] font-normal text-ink-tertiary">no upstream</span>
        ) : repository.ahead ? (
          <span class="rounded-full border border-primary/50 px-1.5 text-[11px] leading-4 font-normal text-primary-hover">
            {repository.ahead} not pushed
          </span>
        ) : null}
        {repository.behind ? (
          <span class="text-[11px] font-normal text-ink-tertiary">{repository.behind} behind</span>
        ) : null}
        {repository.uncommittedFiles > 0 ? (
          <span class="text-[11px] font-normal text-ink-tertiary">
            {repository.uncommittedFiles} uncommitted files
          </span>
        ) : null}
      </h2>
      {repository.commits.length === 0 ? (
        <EmptyState>No commits yet</EmptyState>
      ) : (
        <ul class="flex flex-col divide-y divide-hairline rounded-lg border border-hairline bg-surface-1">
          {repository.commits.map((commit) => (
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
              <span class="shrink-0 text-[11px] text-ink-tertiary">
                {relativeTime(commit.committedAt, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
