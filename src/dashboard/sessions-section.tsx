import { EmptyState } from "../components/empty-state"
import { Section } from "../components/section"
import type { SessionHealth } from "../sessions"
import { relativeTime } from "../time"

// dashboard の Claude Code のセッションのまとまり。費用・キャッシュ・ツールの失敗・人の割り込みを数字で出し、最近のセッションを並べる

const RECENT_SESSIONS_LIMIT = 8

export function SessionsSection({ health, now }: { health: SessionHealth; now: Date }) {
  const { totals } = health
  return (
    <Section title="Agent sessions" count={totals.sessions}>
      {totals.sessions === 0 ? (
        <EmptyState>{`No Claude Code sessions in the last ${health.windowDays} days`}</EmptyState>
      ) : (
        <>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label={`Cost, ${health.windowDays} days (API)`}
              value={usd(totals.costUsd)}
              note={
                totals.unpricedMessages > 0
                  ? `${totals.unpricedMessages} messages from unpriced models`
                  : `${totals.assistantMessages} responses`
              }
            />
            <Metric
              label="Cache read"
              value={percent(totals.cacheReadRatio)}
              note="of prompt tokens"
            />
            <Metric
              label="Tool errors"
              value={percent(totals.toolErrorRatio)}
              note={`${totals.toolErrors} / ${totals.toolResults}`}
            />
            <Metric
              label="Interruptions"
              value={String(totals.interruptions)}
              note="by the human"
            />
          </div>
          <ul class="flex flex-col divide-y divide-hairline rounded-lg border border-hairline bg-surface-1">
            {health.sessions.slice(0, RECENT_SESSIONS_LIMIT).map((session) => (
              <li class="flex flex-col gap-0.5 px-3 py-2.5">
                <div class="flex items-baseline gap-2">
                  <span class="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {session.title ?? session.id.slice(0, 8)}
                  </span>
                  <span class="shrink-0 font-mono text-[12px] text-ink-muted tabular-nums">
                    {usd(session.costUsd)}
                  </span>
                </div>
                <div class="flex flex-wrap gap-x-3 text-[11px] text-ink-tertiary">
                  <span>{relativeTime(session.lastActivityAt ?? "", now)}</span>
                  {session.worktree ? (
                    <span class="font-mono text-ink-subtle">{session.worktree}</span>
                  ) : null}
                  <span>
                    errors {session.toolErrors} / {session.toolResults}
                  </span>
                  {session.interruptions > 0 ? (
                    <span>interrupted {session.interruptions}</span>
                  ) : null}
                  {session.subagents > 0 ? <span>{session.subagents} subagents</span> : null}
                  <span class="truncate">{session.models.join(", ")}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}

// 件数の Stat と違い、値が文字列 (金額や割合) で、下に内訳の注記を添える
function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div class="rounded-lg border border-hairline bg-surface-1 px-3 py-2.5">
      <div class="text-[11px] text-ink-tertiary">{label}</div>
      <div class="mt-0.5 text-xl font-semibold text-ink tabular-nums">{value}</div>
      <div class="mt-0.5 truncate text-[11px] text-ink-tertiary">{note}</div>
    </div>
  )
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`
}

function percent(ratio: number | null): string {
  return ratio === null ? "-" : `${(ratio * 100).toFixed(1)}%`
}
