import { compile } from "tailwindcss"
import tw from "tailwindcss/index.css" with { type: "text" }
import { DashboardPage } from "./dashboard"
import { ProjectsPage } from "./projects"
import type { Question } from "./questions"
import type { SessionHealth } from "./sessions"
import { BLANK, BoardPage, Document, ErrorView } from "./ui"

const INPUT = `@import "tailwindcss";
@theme static {
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
/* 本文の Markdown は描画結果に class を付けられず Tailwind のクラス走査に載らないので、ここでまとめて見た目を付ける */
.markdown {
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-ink-muted);
  overflow-wrap: anywhere;
}
.markdown > * + * {
  margin-top: 0.65em;
}
.markdown :is(h1, h2, h3, h4, h5, h6) {
  color: var(--color-ink);
  font-weight: 600;
  line-height: 1.35;
}
.markdown > :is(h1, h2, h3, h4, h5, h6):not(:first-child) {
  margin-top: 1.3em;
}
.markdown h1 {
  font-size: 1.4em;
}
.markdown h2 {
  font-size: 1.2em;
}
.markdown h3 {
  font-size: 1.05em;
}
.markdown :is(h4, h5, h6) {
  font-size: 1em;
}
.markdown strong {
  color: var(--color-ink);
  font-weight: 600;
}
.markdown ul {
  list-style: disc;
  padding-left: 1.4em;
}
.markdown ol {
  list-style: decimal;
  padding-left: 1.5em;
}
.markdown li > :is(ul, ol) {
  margin-top: 0.2em;
}
.markdown li + li {
  margin-top: 0.2em;
}
.markdown li::marker {
  color: var(--color-ink-tertiary);
}
.markdown li:has(> input[type="checkbox"]) {
  list-style: none;
  margin-left: -1.3em;
}
.markdown input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0 0.45em 0 0;
  vertical-align: -2px;
  accent-color: var(--color-primary);
  cursor: pointer;
}
.markdown li:has(> input[type="checkbox"]:checked) {
  color: var(--color-ink-tertiary);
  text-decoration: line-through;
}
.markdown a {
  color: var(--color-primary-hover);
  text-decoration: underline;
  text-decoration-color: color-mix(in oklab, var(--color-primary-hover) 40%, transparent);
  text-underline-offset: 2px;
}
.markdown code {
  font-family: var(--font-mono);
  font-size: 0.86em;
  padding: 0.1em 0.35em;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.markdown pre {
  padding: 10px 12px;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  overflow-x: auto;
  line-height: 1.55;
}
.markdown pre code {
  padding: 0;
  border: 0;
  background: none;
  font-size: 12.5px;
}
.markdown blockquote {
  padding-left: 12px;
  border-left: 2px solid var(--color-hairline-strong);
  color: var(--color-ink-subtle);
}
.markdown table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 13px;
}
.markdown :is(th, td) {
  padding: 4px 10px;
  border: 1px solid var(--color-hairline);
  text-align: left;
}
.markdown th {
  background: var(--color-surface-2);
  color: var(--color-ink);
  font-weight: 500;
}
.markdown hr {
  border: 0;
  border-top: 1px solid var(--color-hairline);
}
.markdown img {
  max-width: 100%;
  border-radius: var(--radius-md);
}
.markdown.markdown-compact {
  font-size: 13px;
  line-height: 1.6;
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
        worktree: "w",
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
        questions={sampleQuestions}
      />
      <BoardPage issues={issues} all={issues} query="q" current={BLANK} view="list" comments={[]} />
      <BoardPage issues={[]} all={[]} query="" current={null} comments={[]} />
      <BoardPage issues={[]} all={[]} query="none" current={null} comments={[]} />
      <ErrorView message="x" />
      <ProjectsPage
        projects={[
          { slug: "a", root: "/a", awaiting: sampleQuestions.slice(0, 2), inProgress: 1 },
          { slug: "b", root: "/b", awaiting: [], inProgress: 0 },
        ]}
      />
      <ProjectsPage projects={[]} />
      <DashboardPage
        questions={sampleQuestions}
        issues={issues}
        now={new Date("2026-01-01T00:00:00Z")}
        sessionHealth={sampleSessionHealth}
        repository={{
          branch: "b",
          upstream: "u",
          ahead: 1,
          behind: 1,
          uncommittedFiles: 1,
          commits: [
            {
              hash: "h",
              subject: "s",
              author: "a",
              committedAt: "2026-01-01T00:00:00Z",
              pushed: false,
            },
            {
              hash: "i",
              subject: "s",
              author: "a",
              committedAt: "2026-01-01T00:00:00Z",
              pushed: true,
            },
          ],
        }}
        error="x"
      />
      <DashboardPage
        questions={[]}
        issues={[]}
        now={new Date("2026-01-01T00:00:00Z")}
        repository={{
          branch: null,
          upstream: null,
          ahead: null,
          behind: null,
          uncommittedFiles: 0,
          commits: [],
        }}
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
