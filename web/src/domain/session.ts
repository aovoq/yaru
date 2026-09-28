// Claude Code のセッションの数。画面が読む形。型は src/sessions.ts:10-49 と同じ

export type SessionSummary = {
  id: string
  worktree: string | null
  title: string | null
  startedAt: string | null
  lastActivityAt: string | null
  models: string[]
  assistantMessages: number
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  costUsd: number
  unpricedMessages: number
  toolUses: number
  toolResults: number
  toolErrors: number
  interruptions: number
  subagents: number
}

export type SessionTotals = {
  sessions: number
  costUsd: number
  unpricedMessages: number
  assistantMessages: number
  cacheReadRatio: number | null
  toolResults: number
  toolErrors: number
  toolErrorRatio: number | null
  interruptions: number
}

export type SessionHealth = {
  directory: string | null
  windowDays: number
  sessions: SessionSummary[]
  totals: SessionTotals
}

export function emptySessionHealth(): SessionHealth {
  return {
    directory: null,
    windowDays: 0,
    sessions: [],
    totals: {
      sessions: 0,
      costUsd: 0,
      unpricedMessages: 0,
      assistantMessages: 0,
      cacheReadRatio: null,
      toolResults: 0,
      toolErrors: 0,
      toolErrorRatio: null,
      interruptions: 0,
    },
  }
}
