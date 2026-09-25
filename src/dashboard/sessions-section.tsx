import { EmptyState } from "../components/empty-state"
import { ListBox } from "../components/list-box"
import { Section } from "../components/section"
import { StatGrid } from "../components/stat-grid"
import { StatTile } from "../components/stat-tile"
import { percent, usd } from "../format"
import type { SessionHealth } from "../sessions"
import { SessionRow } from "./session-row"
import type { SessionTouches } from "./session-touches"

// dashboard の Claude Code のセッションのまとまり。費用・キャッシュ・ツールの失敗・人の割り込みを数字で出し、最近のセッションを並べる

const RECENT_SESSIONS_LIMIT = 8

export function SessionsSection({
  health,
  now,
  touches,
}: {
  health: SessionHealth
  now: Date
  // セッションの id ごとの、聞いた質問と作った issue (session-touches.ts)
  touches: ReadonlyMap<string, SessionTouches>
}) {
  const { totals } = health
  return (
    <Section title="Agent sessions" count={totals.sessions}>
      {totals.sessions === 0 ? (
        <EmptyState>{`No Claude Code sessions in the last ${health.windowDays} days`}</EmptyState>
      ) : (
        <>
          <StatGrid>
            <StatTile
              size="md"
              label={`Cost, ${health.windowDays} days (API)`}
              value={usd(totals.costUsd)}
              note={
                totals.unpricedMessages > 0
                  ? `${totals.unpricedMessages} messages from unpriced models`
                  : `${totals.assistantMessages} responses`
              }
            />
            <StatTile
              size="md"
              label="Cache read"
              value={percent(totals.cacheReadRatio)}
              note="of prompt tokens"
            />
            <StatTile
              size="md"
              label="Tool errors"
              value={percent(totals.toolErrorRatio)}
              note={`${totals.toolErrors} / ${totals.toolResults}`}
            />
            <StatTile
              size="md"
              label="Interruptions"
              value={String(totals.interruptions)}
              note="by the human"
            />
          </StatGrid>
          <ListBox>
            {health.sessions.slice(0, RECENT_SESSIONS_LIMIT).map((session) => (
              <SessionRow session={session} now={now} touches={touches.get(session.id)} />
            ))}
          </ListBox>
        </>
      )}
    </Section>
  )
}
