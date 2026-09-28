import { renderToString } from "preact-render-to-string"
import { expect, test } from "vitest"
import type { Issue } from "../domain/issue"
import type { Question } from "../domain/question"
import type { RepositoryState } from "../domain/repository"
import type { SessionHealth, SessionSummary } from "../domain/session"
import { DashboardView } from "./dashboard-view"

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
    <DashboardView questions={[]} issues={[]} now={NOW} sessionHealth={health} repository={null} />,
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
    <DashboardView
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
    <DashboardView
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
    <DashboardView
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
    <DashboardView
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
  options: [],
  session: null,
  worktree: null,
  branch: null,
  acknowledgedAt: null,
  notifiedExpiringAt: null,
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
  session: null,
  worktree: null,
  branch: null,
  stale: false,
}

test("an awaiting question links its inputs to an answer form outside the card", () => {
  const html = renderToString(
    <DashboardView
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
  expect(html).toContain(">#4</span>")
  expect(html).toContain("称号の整理")
  expect(html).toContain("Use default")
  expect(html).not.toContain('name="returnTo"')
})

test("a recently answered question shows its answer without an answer form", () => {
  const html = renderToString(
    <DashboardView
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
    <DashboardView
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

function dashboard(overrides: Partial<Parameters<typeof DashboardView>[0]> = {}): string {
  return renderToString(
    <DashboardView
      questions={[]}
      issues={[]}
      now={NOW}
      sessionHealth={health}
      repository={null}
      basePath="/p/app"
      workspaceName="app"
      {...overrides}
    />,
  )
}

const groupedQuestions: Question[] = [
  { ...baseQuestion, id: "1", title: "期限なし", answerBy: null },
  { ...baseQuestion, id: "2", title: "止まっている", defaultAction: null, answerBy: null },
  { ...baseQuestion, id: "3", title: "期限が近い" },
  {
    ...baseQuestion,
    id: "4",
    title: "既定で進んだ",
    status: "expired",
    answerBy: "2026-09-25T11:00:00.000Z",
  },
]

test("awaiting questions are grouped by how urgently the agent needs the answer", () => {
  const html = dashboard({ questions: groupedQuestions })
  const order = [
    'data-question-group="blocking"',
    "止まっている",
    'data-question-group="dueSoon"',
    "期限が近い",
    'data-question-group="noDeadline"',
    "期限なし",
    'data-question-group="proceeded"',
    "既定で進んだ",
  ]
  const positions = order.map((text) => html.indexOf(text))
  expect(positions.every((position) => position >= 0)).toBe(true)
  expect([...positions].sort((first, second) => first - second)).toEqual(positions)
  expect(html).toContain(">Blocking<")
  expect(html).toContain(">Due soon<")
  expect(html).toContain(">Proceeded with default — override?<")
})

test("a group without questions is not shown", () => {
  const html = dashboard({ questions: [groupedQuestions[0]!] })
  expect(html).toContain('data-question-group="noDeadline"')
  expect(html).not.toContain('data-question-group="blocking"')
  expect(html).not.toContain('data-question-group="dueSoon"')
  expect(html).not.toContain('data-question-group="proceeded"')
})

test("a question the agent proceeded past is folded to its title and default", () => {
  const html = dashboard({ questions: [groupedQuestions[3]!] })
  expect(html).toMatch(/data-proceeded[^>]*><details class/)
  expect(html).toMatch(/<summary[\s\S]*?既定で進んだ[\s\S]*?残す[\s\S]*?<\/summary>/)
  expect(html).toContain("Dismiss")
  expect(html).toContain("Answer anyway")
})

test("each answer form returns to the next card, and the last one to the card before it", () => {
  const html = dashboard({ questions: groupedQuestions.slice(0, 3) })
  expect(html).toMatch(/id="answer-question-2"[^>]*>[\s\S]*?name="next" value="q-3"/)
  expect(html).toMatch(/id="answer-question-3"[^>]*>[\s\S]*?name="next" value="q-1"/)
  expect(html).toMatch(/id="answer-question-1"[^>]*>[\s\S]*?name="next" value="q-3"/)
})

test("a failed answer comes back into its card with the draft, not as a banner at the top", () => {
  const html = dashboard({
    questions: [groupedQuestions[3]!],
    returned: { question: "4", error: "cannot answer", answer: "書きかけ" },
  })
  expect(html).toMatch(/data-proceeded[^>]*><details open/)
  expect(html).toMatch(/id="q-4"[\s\S]*?role="alert"[\s\S]*?cannot answer/)
  expect(html).toMatch(/<textarea[^>]*>書きかけ<\/textarea>/)
  expect(html.match(/role="alert"/g)).toHaveLength(1)
})

test("an error for a question without an awaiting card is shown at the top", () => {
  const html = dashboard({
    questions: [
      { ...baseQuestion, status: "answered", answer: "x", answeredAt: NOW.toISOString() },
    ],
    returned: { question: "1", error: "cannot answer question 1: actual answered" },
  })
  expect(html).toContain('role="alert"')
  expect(html).toContain("cannot answer question 1: actual answered")
})

const justAnswered: Question = {
  ...baseQuestion,
  id: "12",
  status: "answered",
  answer: "消してよい",
  answeredBy: "human",
  answeredAt: new Date(NOW.getTime() - 5000).toISOString(),
}

test("right after answering, a toast offers to undo the answer", () => {
  const html = dashboard({ questions: [justAnswered], answered: justAnswered })
  expect(html).toContain("Answered Q12")
  expect(html).toMatch(/action="\/p\/app\/questions\/12\/undo"/)
  expect(html).toContain(`name="answeredAt" value="${justAnswered.answeredAt}"`)
  expect(html).toContain('name="returnTo" value="/p/app/dashboard"')
  expect(html).toContain('data-toast-expires-at="')
})

test("an answer the agent already picked up is announced without an undo", () => {
  const html = dashboard({
    questions: [justAnswered],
    answered: {
      ...justAnswered,
      answeredAt: new Date(NOW.getTime() - 2000).toISOString(),
      acknowledgedAt: NOW.toISOString(),
    },
  })
  expect(html).toContain("Answered Q12")
  expect(html).not.toContain("/questions/12/undo")
})

test("the toast is gone once the undo window has passed", () => {
  const old = { ...justAnswered, answeredAt: "2026-09-25T11:00:00.000Z" }
  expect(dashboard({ questions: [old], answered: old })).not.toContain("Answered Q12")
})

test("stat tiles link to their sections", () => {
  const html = dashboard({ questions: groupedQuestions, issues: [baseIssue] })
  for (const id of ["questions", "proceeded", "in-progress", "overdue"]) {
    expect(html).toContain(`href="#${id}"`)
    expect(html).toContain(`id="${id}"`)
  }
})

test("finished issues past their due date are not counted as overdue", () => {
  const html = dashboard({ issues: [{ ...baseIssue, status: "done" }] })
  expect(html).not.toContain('id="overdue"')
  expect(html).toMatch(/Overdue<\/div>\s*<div[^>]*>0</)
})

test("an in-progress issue that has not moved for a while is marked stale", () => {
  const html = dashboard({ issues: [{ ...baseIssue, stale: true }] })
  expect(html).toContain("data-stale")
})

test("a session row lists the questions and issues it recorded", () => {
  const html = dashboard({
    questions: [{ ...baseQuestion, session: session.id }],
    issues: [{ ...baseIssue, session: session.id }],
  })
  expect(html).toMatch(/ダッシュボードを作る[\s\S]*?href="\/p\/app\/dashboard#q-1"[\s\S]*?Q1/)
  expect(html).toMatch(/ダッシュボードを作る[\s\S]*?href="\/p\/app\/\?id=4"[\s\S]*?#4/)
})

test("the header shows where the dashboard is: projects, the workspace, then the dashboard", () => {
  const html = dashboard()
  expect(html).toMatch(
    /<nav aria-label="Breadcrumb"[\s\S]*?href="\/"[^>]*>(<span[^>]*>)?Projects<[\s\S]*?href="\/p\/app\/"[^>]*>(<span[^>]*>)?app<[\s\S]*?aria-current="page"[^>]*>Dashboard</,
  )
})

test("on wide screens the dashboard sits beside the board's sidebar", () => {
  const html = dashboard({ issues: [baseIssue] })
  expect(html).toContain('id="sidebar"')
  expect(html).toContain('href="/p/app/dashboard"')
  expect(html).toContain('id="sidebar-open"')
})

test("the dashboard has a hidden button to show what changed", () => {
  const html = dashboard({ questions: groupedQuestions })
  expect(html).toMatch(/<button[^>]*id="page-refresh"[^>]*hidden/)
  expect(html).toContain('data-awaiting-ids="q-2 q-3 q-1 q-4"')
})

test("after the last urgent question the answer returns to the folded group, not into it", () => {
  const html = dashboard({ questions: [groupedQuestions[1]!, groupedQuestions[3]!] })
  expect(html).toMatch(/id="answer-question-2"[^>]*>[\s\S]*?name="next" value="proceeded"/)
})

test("a canceled question is not linked from its session, since it has no card", () => {
  const html = dashboard({
    questions: [{ ...baseQuestion, status: "canceled", session: session.id }],
  })
  expect(html).not.toContain('href="/p/app/dashboard#q-1"')
})

test("a fragment inside a folded question opens that details", () => {
  const html = dashboard({ questions: [groupedQuestions[3]!], revealAnchor: "q-4" })
  expect(html).toMatch(/data-proceeded[^>]*><details open/)
})
