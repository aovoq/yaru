import type { Question } from "./questions"
import type { RepositoryState } from "./repository"
import type { SessionHealth } from "./sessions"
import { isOverdue, type Issue, type Priority } from "./store"

// 人が離れた場所 (主にスマホ) から、エージェントの質問に答えて進み具合を見るための画面
// 板 (BoardPage) と違ってクライアントのハイドレーションを持たず、フォームの POST とリロードだけで動かす

export type DashboardData = {
  questions: Question[]
  issues: Issue[]
  now: Date
  sessionHealth: SessionHealth
  repository: RepositoryState | null
  error?: string
}

const RECENTLY_ANSWERED_LIMIT = 10

export const USE_DEFAULT_ANSWER_PREFIX = "Go with the default action: "

const RECENT_SESSIONS_LIMIT = 8

export function DashboardPage({
  questions,
  issues,
  now,
  sessionHealth,
  repository,
  error,
}: DashboardData) {
  const awaiting = questions.filter(
    (question) => question.status === "open" || question.status === "expired",
  )
  const expiredCount = awaiting.filter((question) => question.status === "expired").length
  const answered = questions
    .filter((question) => question.status === "answered")
    .sort((a, b) => (b.answeredAt ?? "").localeCompare(a.answeredAt ?? ""))
    .slice(0, RECENTLY_ANSWERED_LIMIT)
  const inProgress = issues.filter((issue) => issue.status === "in_progress")
  const overdue = issues.filter(
    (issue) =>
      isOverdue(issue.dueDate, now) && issue.status !== "done" && issue.status !== "canceled",
  )
  const issueTitles = new Map(issues.map((issue) => [issue.id, issue.title]))
  return (
    <div class="h-screen overflow-y-auto">
      <header class="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-hairline bg-canvas/90 px-4 backdrop-blur">
        <span class="grid size-5 shrink-0 place-items-center rounded-[5px] bg-primary text-[11px] font-semibold text-on-primary">
          y
        </span>
        <h1 class="text-[13px] font-medium text-ink">Dashboard</h1>
        <p
          id="dashboard-stale"
          hidden
          class="ml-2 rounded-full border border-hairline px-2 py-px text-[11px] text-ink-subtle"
        >
          Updated. Reload after answering.
        </p>
        <a
          href="/"
          class="ml-auto text-xs text-ink-subtle no-underline hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-focus/50"
        >
          Issues
        </a>
      </header>
      <main class="mx-auto flex max-w-2xl flex-col gap-8 px-4 pt-4 pb-16">
        {error ? (
          <p
            role="alert"
            class="rounded-md border border-semantic-danger/40 bg-surface-1 px-3 py-2 text-semantic-danger"
          >
            {error}
          </p>
        ) : null}
        <section class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Awaiting answer"
            value={awaiting.length}
            tone={awaiting.length > 0 ? "attention" : "plain"}
          />
          <Stat label="Expired" value={expiredCount} tone={expiredCount > 0 ? "danger" : "plain"} />
          <Stat label="In progress" value={inProgress.length} tone="plain" />
          <Stat
            label="Overdue"
            value={overdue.length}
            tone={overdue.length > 0 ? "danger" : "plain"}
          />
        </section>
        <section class="flex flex-col gap-3">
          <SectionTitle title="Questions" count={awaiting.length} />
          {awaiting.length === 0 ? (
            <Empty text="No questions awaiting an answer" />
          ) : (
            awaiting.map((question) => (
              <QuestionCard
                question={question}
                issueTitle={question.issue ? issueTitles.get(question.issue) : undefined}
                now={now}
              />
            ))
          )}
        </section>
        <section class="flex flex-col gap-3">
          <SectionTitle title="In progress" count={inProgress.length} />
          {inProgress.length === 0 ? (
            <Empty text="Nothing in progress" />
          ) : (
            <IssueRows issues={inProgress} />
          )}
        </section>
        {overdue.length > 0 ? (
          <section class="flex flex-col gap-3">
            <SectionTitle title="Overdue" count={overdue.length} />
            <IssueRows issues={overdue} />
          </section>
        ) : null}
        {repository ? <RepositorySection repository={repository} now={now} /> : null}
        <SessionsSection health={sessionHealth} now={now} />
        {answered.length > 0 ? (
          <section class="flex flex-col gap-3">
            <SectionTitle title="Recently answered" count={answered.length} />
            <ul class="flex flex-col divide-y divide-hairline rounded-lg border border-hairline bg-surface-1">
              {answered.map((question) => (
                <li class="flex flex-col gap-1 px-3 py-2.5">
                  <div class="flex items-baseline gap-2">
                    <span class="font-mono text-[11px] text-ink-tertiary">Q{question.id}</span>
                    <span class="min-w-0 flex-1 text-[13px] text-ink-muted">{question.title}</span>
                    <span class="shrink-0 text-[11px] text-ink-tertiary">
                      {relativeTime(question.answeredAt ?? "", now)}
                    </span>
                  </div>
                  <p class="whitespace-pre-wrap text-[13px] text-ink">{question.answer}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  )
}

function RepositorySection({ repository, now }: { repository: RepositoryState; now: Date }) {
  return (
    <section class="flex flex-col gap-3">
      <h2 class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-ink">
        Commits
        <span class="font-mono text-[11px] font-normal text-ink-subtle">
          {repository.branch ?? "detached HEAD"}
        </span>
        {repository.upstream === null ? (
          <span class="text-[11px] font-normal text-ink-tertiary">no upstream</span>
        ) : repository.ahead ? (
          <span class="rounded-full border border-primary/50 px-1.5 text-[11px] leading-4 font-normal text-primary-hover">
            {repository.ahead} not pushed
          </span>
        ) : null}
        {repository.behind ? (
          <span class="text-[11px] font-normal text-ink-tertiary">{repository.behind} behind</span>
        ) : null}
        {repository.uncommittedFiles > 0 ? (
          <span class="text-[11px] font-normal text-ink-tertiary">
            {repository.uncommittedFiles} uncommitted files
          </span>
        ) : null}
      </h2>
      {repository.commits.length === 0 ? (
        <Empty text="No commits yet" />
      ) : (
        <ul class="flex flex-col divide-y divide-hairline rounded-lg border border-hairline bg-surface-1">
          {repository.commits.map((commit) => (
            <li
              data-pushed={commit.pushed === null ? undefined : String(commit.pushed)}
              class="flex items-baseline gap-2 px-3 py-2"
            >
              <span
                class={`size-1.5 shrink-0 self-center rounded-full ${
                  commit.pushed === false ? "bg-primary-hover" : "bg-hairline-strong"
                }`}
              />
              <span class="min-w-0 flex-1 text-[13px] text-ink">{commit.subject}</span>
              <span class="shrink-0 text-[11px] text-ink-tertiary">
                {relativeTime(commit.committedAt, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SessionsSection({ health, now }: { health: SessionHealth; now: Date }) {
  const { totals } = health
  return (
    <section class="flex flex-col gap-3">
      <SectionTitle title="Agent sessions" count={totals.sessions} />
      {totals.sessions === 0 ? (
        <Empty text={`No Claude Code sessions in the last ${health.windowDays} days`} />
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
    </section>
  )
}

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

function QuestionCard({
  question,
  issueTitle,
  now,
}: {
  question: Question
  issueTitle: string | undefined
  now: Date
}) {
  const expired = question.status === "expired"
  return (
    <article
      data-question-status={question.status}
      class={`flex flex-col gap-3 rounded-lg border bg-surface-1 p-3 ${
        expired ? "border-semantic-danger/40" : "border-hairline"
      }`}
    >
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span class="font-mono text-ink-tertiary">Q{question.id}</span>
        {question.priority ? <PriorityBadge priority={question.priority} /> : null}
        {question.answerBy ? (
          <span class={expired ? "text-semantic-danger" : "text-ink-subtle"}>
            {expired
              ? `Expired ${relativeTime(question.answerBy, now)}`
              : `Answer by ${localTime(question.answerBy)} (${relativeTime(question.answerBy, now)})`}
          </span>
        ) : (
          <span class="text-ink-tertiary">No deadline</span>
        )}
        {question.issue ? (
          <a
            href={`/?id=${encodeURIComponent(question.issue)}`}
            class="min-w-0 truncate text-ink-subtle no-underline hover:text-ink"
          >
            #{question.issue} {issueTitle ?? ""}
          </a>
        ) : null}
      </div>
      <h2 class="text-[15px] leading-snug font-medium text-ink">{question.title}</h2>
      {question.body ? (
        <p class="whitespace-pre-wrap text-[13px] text-ink-muted">{question.body}</p>
      ) : null}
      {question.defaultAction ? (
        <p class="rounded-md border border-hairline bg-surface-2 px-2.5 py-2 text-[13px] text-ink-muted">
          <span class="mr-1.5 text-[11px] text-ink-tertiary">
            {expired ? "Proceeding with default" : "Default"}
          </span>
          {question.defaultAction}
        </p>
      ) : null}
      <form
        method="post"
        action={`/questions/${encodeURIComponent(question.id)}/answer`}
        class="flex flex-col gap-2"
      >
        <textarea
          name="body"
          rows={3}
          placeholder="Answer"
          class="w-full resize-y rounded-md border border-hairline bg-canvas px-2.5 py-2 text-[15px] text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none sm:text-[13px]"
        />
        <div class="flex gap-2">
          <button
            type="submit"
            class="h-9 flex-1 rounded-md bg-primary px-3 text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-hover active:bg-primary-focus sm:flex-none"
          >
            Answer
          </button>
          {question.defaultAction ? (
            <button
              type="submit"
              name="useDefault"
              value="1"
              formnovalidate
              class="h-9 flex-1 rounded-md border border-hairline px-3 text-[13px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:flex-none"
            >
              Use default
            </button>
          ) : null}
        </div>
      </form>
    </article>
  )
}

function IssueRows({ issues }: { issues: Issue[] }) {
  return (
    <ul class="flex flex-col divide-y divide-hairline rounded-lg border border-hairline bg-surface-1">
      {issues.map((issue) => (
        <li>
          <a
            href={`/?id=${encodeURIComponent(issue.id)}`}
            class="flex items-baseline gap-2 px-3 py-2.5 no-underline hover:bg-surface-2"
          >
            <span class="font-mono text-[11px] text-ink-tertiary">#{issue.id}</span>
            <span class="min-w-0 flex-1 text-[13px] text-ink">{issue.title}</span>
            {issue.dueDate ? (
              <span class="shrink-0 font-mono text-[11px] text-ink-subtle">{issue.dueDate}</span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "plain" | "attention" | "danger"
}) {
  const valueClass =
    tone === "danger"
      ? "text-semantic-danger"
      : tone === "attention"
        ? "text-primary-hover"
        : "text-ink"
  return (
    <div class="rounded-lg border border-hairline bg-surface-1 px-3 py-2.5">
      <div class="text-[11px] text-ink-tertiary">{label}</div>
      <div class={`mt-0.5 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  )
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <h2 class="flex items-center gap-2 text-[13px] font-medium text-ink">
      {title}
      <span class="font-normal text-ink-tertiary tabular-nums">{count}</span>
    </h2>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <p class="rounded-lg border border-dashed border-hairline px-3 py-4 text-center text-[13px] text-ink-tertiary">
      {text}
    </p>
  )
}

const PRIORITY_CLASS: Record<Priority, string> = {
  urgent: "border-priority-urgent/40 text-priority-urgent",
  high: "border-priority-high/40 text-priority-high",
  medium: "border-priority-medium/40 text-priority-medium",
  low: "border-hairline text-priority-low",
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span class={`rounded-full border px-1.5 leading-4 ${PRIORITY_CLASS[priority]}`}>
      {priority}
    </span>
  )
}

// 答えを書きかけているときにリロードで消さないよう、入力中は再読み込みせず表示だけ出す
export const DASHBOARD_LIVE_RELOAD = `(()=>{const source=new EventSource("/events");source.onmessage=()=>{const editing=[...document.querySelectorAll("textarea")].some((element)=>element.value.trim()!==""||element===document.activeElement);if(editing){document.getElementById("dashboard-stale")?.removeAttribute("hidden");return}location.reload()}})()`

export function relativeTime(iso: string, now: Date): string {
  const target = Date.parse(iso)
  if (Number.isNaN(target)) return "-"
  const difference = target - now.getTime()
  const minutes = Math.round(Math.abs(difference) / 60_000)
  const span =
    minutes < 1
      ? "now"
      : minutes < 60
        ? `${minutes}m`
        : minutes < 60 * 48
          ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
          : `${Math.floor(minutes / (60 * 24))}d`
  if (span === "now") return "now"
  return difference >= 0 ? `in ${span}` : `${span} ago`
}

function localTime(iso: string): string {
  const date = new Date(iso)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${month}-${day} ${hours}:${minutes}`
}
