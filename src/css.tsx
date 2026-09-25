import { compile } from "tailwindcss"
import tw from "tailwindcss/index.css" with { type: "text" }
import { DashboardPage } from "./dashboard"
import type { Question } from "./questions"
import type { SessionHealth } from "./sessions"
import { BLANK, BoardPage, Document, ErrorView } from "./ui"

const INPUT = `@import "tailwindcss";
@theme {
  --color-ink: #f7f8f8;
  --color-ink-muted: #d0d6e0;
  --color-ink-subtle: #8a8f98;
  --color-ink-tertiary: #62666d;
  --color-canvas: #010102;
  --color-surface-1: #0f1011;
  --color-surface-2: #141516;
  --color-surface-3: #18191a;
  --color-surface-4: #191a1b;
  --color-hairline: #23252a;
  --color-hairline-strong: #34343a;
  --color-primary: #5e6ad2;
  --color-primary-hover: #828fff;
  --color-primary-focus: #5e69d1;
  --color-on-primary: #ffffff;
  --color-semantic-success: #27a644;
  --color-semantic-danger: #eb5757;
  --color-priority-urgent: #eb5757;
  --color-priority-high: #f2994a;
  --color-priority-medium: #f2c94c;
  --color-priority-low: #8a8f98;
  --font-sans: Inter, "SF Pro Display", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
}
@layer base {
  ::selection {
    background: color-mix(in oklab, #5e6ad2 45%, transparent);
  }
  * {
    scrollbar-width: thin;
    scrollbar-color: #34343a transparent;
  }
}
#sidebar {
  width: var(--sidebar-width, 14rem);
}
html[data-sidebar="closed"] #sidebar {
  display: none;
}
@media (min-width: 768px) {
  html[data-sidebar="closed"] #sidebar-open {
    display: grid;
  }
}
html[data-resizing],
html[data-resizing] * {
  cursor: col-resize !important;
  user-select: none !important;
}
html[data-resizing] #sidebar-resizer {
  background: #5e6ad2;
}
`

let cached: Promise<string> | undefined

export function styles(): Promise<string> {
  cached ??= build()
  return cached
}

async function build(): Promise<string> {
  const compiler = await compile(INPUT, {
    loadStylesheet: async (id, base) => {
      if (id === "tailwindcss") return { path: id, base, content: tw }
      throw new Error(`unknown stylesheet: ${id}`)
    },
  })
  const sample = await sampleHtml()
  return compiler.build(candidates(sample))
}

async function sampleHtml(): Promise<string> {
  const issue = {
    ...BLANK,
    id: "1",
    title: "x",
    labels: ["a", "b"],
    assignee: "me",
    body: "b",
    dueDate: "2000-01-01",
    priority: "urgent" as const,
  }
  const issues = [
    issue,
    { ...issue, id: "2", status: "backlog", dueDate: "2099-01-01", priority: "high" as const },
    { ...issue, id: "3", status: "in_progress", dueDate: null, priority: "medium" as const },
    { ...issue, id: "4", status: "done", dueDate: null, priority: "low" as const },
    { ...issue, id: "5", status: "canceled", assignee: null, priority: null, labels: [] },
  ]
  const question: Question = {
    id: "1",
    title: "q",
    status: "open",
    issue: "1",
    priority: "urgent",
    defaultAction: "d",
    answerBy: "2026-01-01T01:00:00.000Z",
    author: "me",
    answer: null,
    answeredBy: null,
    answeredAt: null,
    canceledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    body: "b",
  }
  const sampleQuestions: Question[] = [
    question,
    {
      ...question,
      id: "2",
      status: "expired",
      priority: "high",
      answerBy: "2025-12-31T00:00:00.000Z",
    },
    { ...question, id: "3", priority: "medium", answerBy: null, defaultAction: null, body: "" },
    { ...question, id: "4", priority: "low" },
    {
      ...question,
      id: "5",
      status: "answered",
      priority: null,
      answer: "a",
      answeredAt: "2026-01-01T00:00:00.000Z",
    },
  ]
  const sampleSessionHealth: SessionHealth = {
    directory: "d",
    windowDays: 7,
    sessions: [
      {
        id: "s",
        title: "t",
        startedAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        models: ["m"],
        assistantMessages: 1,
        inputTokens: 1,
        cacheCreationTokens: 1,
        cacheReadTokens: 1,
        outputTokens: 1,
        costUsd: 1,
        unpricedMessages: 0,
        toolUses: 1,
        toolResults: 1,
        toolErrors: 1,
        interruptions: 1,
        subagents: 1,
      },
    ],
    totals: {
      sessions: 1,
      costUsd: 1,
      unpricedMessages: 1,
      assistantMessages: 1,
      cacheReadRatio: 1,
      toolResults: 1,
      toolErrors: 1,
      toolErrorRatio: 1,
      interruptions: 1,
    },
  }
  const node = (
    <Document css="">
      <BoardPage
        issues={issues}
        all={issues}
        query="q"
        current={issue}
        view="board"
        status="todo"
        assignee="me"
        label="a"
        error="title is required"
        comments={[]}
      />
      <BoardPage issues={issues} all={issues} query="q" current={BLANK} view="list" comments={[]} />
      <BoardPage issues={[]} all={[]} query="" current={null} comments={[]} />
      <BoardPage issues={[]} all={[]} query="none" current={null} comments={[]} />
      <ErrorView message="x" />
      <DashboardPage
        questions={sampleQuestions}
        issues={issues}
        now={new Date("2026-01-01T00:00:00Z")}
        sessionHealth={sampleSessionHealth}
        error="x"
      />
      <DashboardPage
        questions={[]}
        issues={[]}
        now={new Date("2026-01-01T00:00:00Z")}
        sessionHealth={{
          ...sampleSessionHealth,
          sessions: [],
          totals: { ...sampleSessionHealth.totals, sessions: 0 },
        }}
      />
    </Document>
  )
  return String(await node)
}

function candidates(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(/class="([^"]*)"/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (token) out.add(token)
    }
  }
  return [...out]
}
