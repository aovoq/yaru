import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { DashboardPage } from "./dashboard"
import type { Question } from "./questions"
import type { RepositoryState } from "./repository"
import type { SessionHealth, SessionSummary } from "./sessions"
import type { Issue } from "./store"

const NOW = new Date("2026-09-25T12:00:00.000Z")

const session: SessionSummary = {
  id: "b7c46321-5176-43e5-8eca-b897ae492e7c",
  worktree: null,
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

test("the dashboard shows session health in plain numbers", () => {
  const html = renderToString(
    <DashboardPage questions={[]} issues={[]} now={NOW} sessionHealth={health} repository={null} />,
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

test("a session without a title falls back to its short id", () => {
  const html = renderToString(
    <DashboardPage
      questions={[]}
      issues={[]}
      now={NOW}
      sessionHealth={{ ...health, sessions: [{ ...session, title: null }] }}
      repository={null}
    />,
  )
  expect(html).toContain("b7c46321")
})

const repository: RepositoryState = {
  branch: "develop",
  upstream: "origin/develop",
  ahead: 2,
  behind: 0,
  uncommittedFiles: 3,
  commits: [
    {
      hash: "abc1234",
      subject: "未送信のコミット",
      author: "a",
      committedAt: "2026-09-25T11:00:00+09:00",
      pushed: false,
    },
    {
      hash: "def5678",
      subject: "送信済みのコミット",
      author: "a",
      committedAt: "2026-09-24T11:00:00+09:00",
      pushed: true,
    },
  ],
}

test("the dashboard shows the branch, commits not pushed, and uncommitted files", () => {
  const html = renderToString(
    <DashboardPage
      questions={[]}
      issues={[]}
      now={NOW}
      sessionHealth={health}
      repository={repository}
    />,
  )
  expect(html).toContain("develop")
  expect(html).toContain("2 not pushed")
  expect(html).toContain("3 uncommitted files")
  expect(html).toContain("未送信のコミット")
  expect(html).toContain('data-pushed="false"')
  expect(html).toContain('data-pushed="true"')
})

test("without an upstream the dashboard says the push state is unknown", () => {
  const html = renderToString(
    <DashboardPage
      questions={[]}
      issues={[]}
      now={NOW}
      sessionHealth={health}
      repository={{ ...repository, upstream: null, ahead: null, behind: null }}
    />,
  )
  expect(html).toContain("no upstream")
})

test("a session from a worktree shows its branch", () => {
  const html = renderToString(
    <DashboardPage
      questions={[]}
      issues={[]}
      now={NOW}
      sessionHealth={{ ...health, sessions: [{ ...session, worktree: "feature/add-thing" }] }}
      repository={null}
    />,
  )
  expect(html).toContain("feature/add-thing")
})

const baseQuestion: Question = {
  id: "1",
  title: "称号を消すか",
  status: "open",
  issue: "4",
  priority: "high",
  defaultAction: "残す",
  answerBy: "2026-09-25T14:00:00.000Z",
  author: "agent",
  answer: null,
  answeredBy: null,
  answeredAt: null,
  canceledAt: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
  body: "背景の説明",
}

const baseIssue: Issue = {
  id: "4",
  title: "称号の整理",
  status: "in_progress",
  assignee: null,
  labels: [],
  dueDate: "2026-09-20",
  priority: null,
  parent: null,
  blocks: [],
  blockedBy: [],
  children: [],
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
  body: "",
}

test("an awaiting question links its inputs to an answer form outside the card", () => {
  const html = renderToString(
    <DashboardPage
      questions={[baseQuestion]}
      issues={[baseIssue]}
      now={NOW}
      sessionHealth={health}
      repository={null}
      basePath="/p/app"
    />,
  )
  expect(html).toContain('id="answer-question-1"')
  expect(html).toContain('action="/p/app/questions/1/answer"')
  expect(html).toContain('form="answer-question-1"')
  expect(html).toContain('href="/p/app/?id=4"')
  expect(html).toContain("#4 称号の整理")
  expect(html).toContain("Use default")
  expect(html).not.toContain('name="returnTo"')
})

test("a recently answered question shows its answer without an answer form", () => {
  const html = renderToString(
    <DashboardPage
      questions={[
        {
          ...baseQuestion,
          status: "answered",
          answer: "**消してよい**",
          answeredBy: "human",
          answeredAt: "2026-09-25T11:00:00.000Z",
        },
      ]}
      issues={[]}
      now={NOW}
      sessionHealth={health}
      repository={null}
    />,
  )
  expect(html).toContain("Recently answered")
  expect(html).toContain('data-question-status="answered"')
  expect(html).toContain("<strong>消してよい</strong>")
  expect(html).toContain("Answered 1h ago")
  expect(html).toContain("No questions awaiting an answer")
  expect(html).not.toContain("answer-question-1")
})

test("in-progress and overdue issues link to the board with their due date", () => {
  const html = renderToString(
    <DashboardPage
      questions={[]}
      issues={[baseIssue]}
      now={NOW}
      sessionHealth={health}
      repository={null}
    />,
  )
  expect(html).toContain("In progress")
  expect(html).toContain("Overdue")
  expect(html.match(/href="\/\?id=4"/g)?.length).toBe(2)
})
