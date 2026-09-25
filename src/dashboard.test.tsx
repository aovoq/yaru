import { expect, test } from "bun:test"
import { DashboardPage } from "./dashboard"
import type { SessionHealth, SessionSummary } from "./sessions"

const NOW = new Date("2026-09-25T12:00:00.000Z")

const session: SessionSummary = {
  id: "b7c46321-5176-43e5-8eca-b897ae492e7c",
  title: "ダッシュボードを作る",
  startedAt: "2026-09-25T09:00:00.000Z",
  lastActivityAt: "2026-09-25T11:30:00.000Z",
  models: ["claude-opus-5-5"],
  assistantMessages: 120,
  inputTokens: 10,
  cacheCreationTokens: 10,
  cacheReadTokens: 980,
  outputTokens: 5,
  costUsd: 12.345,
  unpricedMessages: 0,
  toolUses: 100,
  toolResults: 100,
  toolErrors: 2,
  interruptions: 1,
  subagents: 3,
}

const health: SessionHealth = {
  directory: "/home/me/.claude/projects/-app",
  windowDays: 7,
  sessions: [session],
  totals: {
    sessions: 1,
    costUsd: 12.345,
    unpricedMessages: 4,
    assistantMessages: 120,
    cacheReadRatio: 0.98,
    toolResults: 100,
    toolErrors: 2,
    toolErrorRatio: 0.02,
    interruptions: 1,
  },
}

test("the dashboard shows session health in plain numbers", async () => {
  const html = String(
    await (<DashboardPage questions={[]} issues={[]} now={NOW} sessionHealth={health} />),
  )
  expect(html).toContain("Agent sessions")
  expect(html).toContain("$12.35")
  expect(html).toContain("98.0%")
  expect(html).toContain("2.0%")
  expect(html).toContain("2 / 100")
  expect(html).toContain("4 messages from unpriced models")
  expect(html).toContain("ダッシュボードを作る")
  expect(html).toContain("30m ago")
  expect(html).toContain("3 subagents")
})

test("a session without a title falls back to its short id", async () => {
  const html = String(
    await (
      <DashboardPage
        questions={[]}
        issues={[]}
        now={NOW}
        sessionHealth={{ ...health, sessions: [{ ...session, title: null }] }}
      />
    ),
  )
  expect(html).toContain("b7c46321")
})
