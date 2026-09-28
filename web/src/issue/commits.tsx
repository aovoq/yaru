import { RelativeTime } from "../components/relative-time"
import { Section } from "../components/section"
import type { Commit } from "./model"

// この issue に関わるコミットを新しい順に並べる。まだ送っていないものは点を primary の色にし、読み上げの文も付ける
// 送ったかどうかが分からないときは点も data-pushed も付けない

export function Commits({ commits, now }: { commits: Commit[]; now: Date }) {
  if (commits.length === 0) return null
  return (
    <Section title="Commits" count={commits.length}>
      <ul class="flex flex-col overflow-hidden rounded-lg border border-hairline bg-surface-1">
        {commits.map((commit) => (
          <li
            key={commit.hash}
            data-pushed={commit.pushed === null ? undefined : String(commit.pushed)}
            class="flex min-h-9 items-center gap-2.5 border-b border-hairline/60 px-3 py-1.5 last:border-b-0"
          >
            {commit.pushed === null ? null : (
              <span
                title={commit.pushed ? "Pushed" : "Not pushed"}
                class={`size-1.5 shrink-0 rounded-full ${
                  commit.pushed ? "bg-hairline-strong" : "bg-primary-hover"
                }`}
              >
                <span class="sr-only">{commit.pushed ? "Pushed" : "Not pushed"}</span>
              </span>
            )}
            <code class="w-16 shrink-0 font-mono text-micro text-ink-tertiary">{commit.hash}</code>
            <span class="min-w-0 flex-1 truncate text-body text-ink" title={commit.subject}>
              {commit.subject}
            </span>
            <span class="hidden shrink-0 text-micro text-ink-tertiary sm:inline">
              {commit.author}
            </span>
            <RelativeTime
              at={commit.committedAt}
              now={now}
              class="shrink-0 text-micro text-ink-tertiary tabular-nums"
            />
          </li>
        ))}
      </ul>
    </Section>
  )
}
