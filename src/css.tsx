import { compile } from "tailwindcss"
import tw from "tailwindcss/index.css" with { type: "text" }
import { renderToString } from "preact-render-to-string"
import { ContextMenu } from "./client/context-menu/context-menu"
import { Avatar } from "./components/avatar"
import { Button, type ButtonSize, type ButtonVariant } from "./components/button"
import { IconButton } from "./components/icon-button"
import { InlineInput } from "./components/inline-input"
import { InlineSelect } from "./components/inline-select"
import { Kbd } from "./components/kbd"
import { LabelDot } from "./components/label-dot"
import { LogoLink } from "./components/logo-link"
import { Notice } from "./components/notice"
import { Popover } from "./components/popover"
import { Combobox } from "./components/combobox"
import { StatusIcon } from "./components/icons/status-icon"
import { TextLink } from "./components/text-link"
import { Textarea } from "./components/textarea"
import { LABEL_PALETTE } from "./components/tint"
import { issueMenu } from "./client/issue-menu"
import { DashboardPage } from "./dashboard"
import { INTER_FONT_PATH } from "./font"
import { ProjectsPage } from "./projects"
import type { Question } from "./questions"
import type { SessionHealth } from "./sessions"
import { DEFAULT_ISSUE_DISPLAY } from "./issue-order"
import { BLANK } from "./page"
import { BoardPage } from "./ui/board-page"
import { Document } from "./ui/document"
import { ErrorView } from "./ui/error-view"

// 画面の見た目の決まり (design token)。部品はここで決めた名前のクラスだけを使い、text-[13px] や rounded-[5px] のような直の値を書かない
//
// 字の大きさ (行の高さ) は 5 段。本文の Markdown (.markdown) だけは長文を読むので 14px (text-prose) にする
//   text-micro   11px (16px)  補足の数・日時・キーの表記・札の中の字
//   text-small   12px (16px)  一覧の副情報・小さいボタン・見出しの帯のリンク
//   text-body    13px (20px)  画面の既定。一覧の題名・属性・ボタン・入力欄
//   text-title   15px (22px)  カードや節の見出し
//   text-display 26px (32px)  issue の題名などの大見出し
//   入力欄は sm の幅より狭い画面では text-base (16px) にする。iOS の Safari は 16px 未満の欄に focus すると画面を拡大するため
//   行の高さは比で持つ。px で持つと、字の大きさだけを変えた子に小さい行の高さが受け継がれて字が重なるため
//
// 角の丸みは 5 段。rounded (段の名前なし) は使わない
//   rounded-xs 4px  キーの表記 (Kbd)・20px のアイコンのボタン・字だけのボタンとリンクの focus の枠
//   rounded-sm 6px  札 (Pill・Chip)・ロゴ
//   rounded-md 8px  ボタン・入力欄・メニューの項目
//   rounded-lg 10px カード・一覧の枠
//   rounded-xl 14px 重ねて出す面 (メニュー・画面の上に出す枠)
//
// 字の色は 4 段。ink-tertiary が一番薄く、canvas から surface-4 のどの地に置いても 4.5:1 以上ある
// WCAG 2.2 の "a contrast ratio of at least 4.5:1" https://www.w3.org/TR/WCAG22/#contrast-minimum
//   ink 本文と題名、ink-muted 本文の Markdown、ink-subtle 副情報、ink-tertiary 補足と placeholder
//
// 画面の端の余白は pt-safe・pb-safe・pl-safe・pr-safe。viewport-fit=cover (document.tsx) で切り欠きと角の下まで描くので、
// 上端と下端に固定する帯や、画面の端に付く面はこれで端末の切り欠きと home indicator を避ける
const INPUT = `@import "tailwindcss";
@theme static {
  --color-ink: #f7f8f8;
  --color-ink-muted: #d0d6e0;
  --color-ink-subtle: #8a8f98;
  --color-ink-tertiary: #7e828b;
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
  --font-sans: InterVariable, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
  --font-sans--font-feature-settings: "cv11", "ss01";
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --text-micro: 11px;
  --text-micro--line-height: calc(16 / 11);
  --text-small: 12px;
  --text-small--line-height: calc(16 / 12);
  --text-body: 13px;
  --text-body--line-height: calc(20 / 13);
  --text-prose: 14px;
  --text-prose--line-height: 1.7;
  --text-title: 15px;
  --text-title--line-height: calc(22 / 15);
  --text-display: 26px;
  --text-display--line-height: calc(32 / 26);
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 14px;
}
/* 欧文は assets/fonts の Inter (font.ts が配る)。和文は Inter に無いので font-sans の後ろの system-ui や Hiragino Sans に落ちる */
/* cv11 は一階建ての a、ss01 は開いた形の数字 https://rsms.me/inter/#features */
@font-face {
  font-family: InterVariable;
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("${INTER_FONT_PATH}") format("woff2");
}
@utility pt-safe {
  padding-top: env(safe-area-inset-top);
}
@utility pb-safe {
  padding-bottom: env(safe-area-inset-bottom);
}
@utility pl-safe {
  padding-left: env(safe-area-inset-left);
}
@utility pr-safe {
  padding-right: env(safe-area-inset-right);
}
@layer base {
  /* Collapsible は details / summary で作るので、Safari が summary の前に出す三角を消す */
  summary::-webkit-details-marker {
    display: none;
  }
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
  font-size: var(--text-prose);
  line-height: var(--text-prose--line-height);
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
  border-radius: var(--radius-xs);
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
  font-size: var(--text-small);
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
  font-size: var(--text-body);
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
  font-size: var(--text-body);
  line-height: 1.6;
}
/* issue 画面は板の上に重ね、広い画面ではサイドバーを隠さない */
@media (min-width: 768px) {
  html:not([data-sidebar="closed"]) .issue-view {
    left: var(--sidebar-width, 14rem);
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

const BUTTON_VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "text", "plain"]
const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "xs", "inline"]

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
    { ...issue, id: "6", parent: "1", status: "done" },
    { ...issue, id: "7", parent: "1", assignee: null },
  ]
  // issue 画面の全部の欄 (子 issue・関係・活動・親) が出る状態
  const detailedIssue = {
    ...issue,
    parent: "2",
    blocks: ["3"],
    blockedBy: ["4"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    canceledAt: "2026-01-01T00:00:00.000Z",
  }
  const sampleComments = [
    {
      id: "1",
      issue: "1",
      parent: null,
      author: "me",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      body: "c",
    },
    {
      id: "2",
      issue: "1",
      parent: "1",
      author: "me",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      body: "r",
    },
  ]
  const question: Question = {
    id: "1",
    title: "q",
    status: "open",
    issue: "1",
    priority: "urgent",
    defaultAction: "d",
    answerBy: "2026-01-01T01:00:00.000Z",
    options: ["o", "p"],
    author: "me",
    session: "s",
    worktree: "w",
    branch: "b",
    answer: null,
    answeredBy: null,
    answeredAt: null,
    acknowledgedAt: null,
    notifiedExpiringAt: null,
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
    {
      ...question,
      id: "3",
      priority: "medium",
      answerBy: null,
      defaultAction: null,
      options: [],
      session: null,
      worktree: null,
      branch: null,
      body: "",
    },
    { ...question, id: "4", priority: "low" },
    {
      ...question,
      id: "5",
      status: "answered",
      priority: null,
      answer: "a",
      answeredAt: "2026-01-01T00:00:00.000Z",
      acknowledgedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      ...question,
      id: "6",
      status: "answered",
      answer: "a",
      answeredAt: "2026-01-01T00:00:00.000Z",
    },
  ]
  // 板の既定の見せ方。詳しい状態は 1 つ目の BoardPage にだけ渡す
  const page = {
    events: [],
    commits: [],
    awaiting: false,
    awaitingByIssue: {},
    display: DEFAULT_ISSUE_DISPLAY,
  }
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
        {...page}
        events={[
          {
            field: "status",
            from: "todo",
            to: "in_progress",
            by: "me",
            session: "s",
            at: "2026-01-01T00:00:00.000Z",
          },
          {
            field: "labels",
            from: [],
            to: ["a"],
            by: "me",
            session: null,
            at: "2026-01-01T00:00:00.000Z",
          },
        ]}
        commits={[{ hash: "h", subject: "s", author: "a", committedAt: "2026-01-01T00:00:00Z" }]}
        awaiting
        awaitingByIssue={{
          "1": { count: 2, expired: 1, soonestAnswerBy: "2026-01-01T01:00:00.000Z" },
        }}
        issues={issues}
        all={issues}
        query="q"
        current={detailedIssue}
        view="board"
        status="todo"
        assignee="me"
        label="a"
        error="title is required"
        comments={sampleComments}
        questions={sampleQuestions}
      />
      <BoardPage
        {...page}
        issues={issues}
        all={issues}
        query=""
        current={{ ...issue, body: "", labels: [], assignee: null, parent: null }}
        comments={[]}
      />
      <BoardPage
        {...page}
        issues={issues}
        all={issues}
        query="q"
        current={BLANK}
        view="list"
        comments={[]}
      />
      <BoardPage {...page} issues={[]} all={[]} query="" current={null} comments={[]} />
      <BoardPage {...page} issues={[]} all={[]} query="none" current={null} comments={[]} />
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
  // 右クリックのメニューと知らせは操作したあとにしか描かれないので、ここで描いてクラスを拾う
  const interactions = (
    <>
      <ContextMenu
        menu={{
          items: issueMenu(issue, issues, { now: new Date(0), boardUrl: "http://x/" }),
          x: 0,
          y: 0,
        }}
        onAction={() => {}}
        onClose={() => {}}
      />
      <Notice text="x" />
      <Notice text={null} />
      <Popover open onClose={() => {}} trigger={<button type="button">t</button>}>
        <Combobox
          label="Labels"
          multiple
          options={[
            { value: "a", label: "a", icon: <StatusIcon status="todo" decorative /> },
            { value: "b", label: "b" },
          ]}
          selected={["a"]}
          onSelect={() => {}}
          onCreate={() => {}}
        />
      </Popover>
      <Popover open align="end" onClose={() => {}} trigger={<button type="button">t</button>}>
        <Combobox label="Status" options={[]} selected={[]} onSelect={() => {}} />
      </Popover>
    </>
  )
  // 共通の部品は、まだどの画面も使っていない大きさや種類があっても CSS に載せておく
  // 画面の側が新しい組み合わせを使い始めたときに、見本を足し忘れて黙って効かなくなるのを防ぐ
  const primitives = (
    <>
      {BUTTON_VARIANTS.flatMap((variant) =>
        BUTTON_SIZES.map((size) => (
          <Button variant={variant} size={size}>
            x
          </Button>
        )),
      )}
      <Button align="start" cursor="text">
        x
      </Button>
      <IconButton label="x" size="sm" />
      <IconButton label="x" size="xs" />
      <TextLink href="/" size="xs" tone="primary">
        x
      </TextLink>
      <TextLink href="/">x</TextLink>
      <LogoLink />
      <Kbd>x</Kbd>
      <Kbd variant="plain">x</Kbd>
      <Kbd variant="on-primary">x</Kbd>
      <Textarea />
      <Textarea mono />
      <InlineInput />
      <InlineSelect name="x" value="x" onChange={() => {}} />
      <LabelDot label="x" color={LABEL_PALETTE[0]} />
      <Avatar name="x" color={LABEL_PALETTE[0]} />
      <div class="pt-safe pr-safe pb-safe pl-safe text-micro text-small text-body text-prose text-title text-display" />
    </>
  )
  return renderToString(node) + renderToString(interactions) + renderToString(primitives)
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
