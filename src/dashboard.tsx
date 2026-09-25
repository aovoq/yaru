import { EmptyState } from "./components/empty-state"
import { LogoLink } from "./components/icons"
import { IssueLinkList } from "./components/issue-link-list"
import { isAwaitingAnswer } from "./components/question-card"
import { Section } from "./components/section"
import { AwaitingQuestionsSection, RecentlyAnsweredSection } from "./dashboard/question-sections"
import { RepositorySection } from "./dashboard/repository-section"
import { SessionsSection } from "./dashboard/sessions-section"
import { Stat } from "./dashboard/stat"
import type { Question } from "./questions"
import type { RepositoryState } from "./repository"
import type { SessionHealth } from "./sessions"
import { isOverdue, type Issue } from "./store"

// 人が離れた場所 (主にスマホ) から、エージェントの質問に答えて進み具合を見るための画面
// 板 (BoardPage) と違ってクライアントのハイドレーションを持たず、フォームの POST とリロードだけで動かす

export type DashboardData = {
  questions: Question[]
  issues: Issue[]
  now: Date
  sessionHealth: SessionHealth
  repository: RepositoryState | null
  // 1 つの yaru serve で複数のワークスペースを配るときの、このワークスペースの URL の接頭辞。単独なら ""
  basePath?: string
  // 一覧 (/) に戻るときに見せるワークスペースの名前
  workspaceName?: string
  error?: string
}

const RECENTLY_ANSWERED_LIMIT = 10

export const USE_DEFAULT_ANSWER_PREFIX = "Go with the default action: "

export function DashboardPage({
  questions,
  issues,
  now,
  sessionHealth,
  repository,
  basePath = "",
  workspaceName,
  error,
}: DashboardData) {
  const awaiting = questions.filter(isAwaitingAnswer)
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
  const issueHref = (issue: Issue) => `${basePath}/?id=${encodeURIComponent(issue.id)}`
  return (
    <div class="h-screen overflow-y-auto">
      <header class="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-hairline bg-canvas/90 px-4 backdrop-blur">
        <LogoLink />
        {workspaceName ? (
          <a
            href="/"
            class="text-[13px] text-ink-subtle no-underline hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-focus/50"
          >
            {workspaceName}
          </a>
        ) : null}
        <h1 class="text-[13px] font-medium text-ink">Dashboard</h1>
        <p
          id="dashboard-stale"
          hidden
          class="ml-2 rounded-full border border-hairline px-2 py-px text-[11px] text-ink-subtle"
        >
          Updated. Reload after answering.
        </p>
        <a
          href={`${basePath}/`}
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
        <AwaitingQuestionsSection
          questions={awaiting}
          issueTitles={issueTitles}
          basePath={basePath}
          now={now}
        />
        <Section title="In progress" count={inProgress.length}>
          {inProgress.length === 0 ? (
            <EmptyState>Nothing in progress</EmptyState>
          ) : (
            <IssueLinkList issues={inProgress} hrefFor={issueHref} showDueDate />
          )}
        </Section>
        {overdue.length > 0 ? (
          <Section title="Overdue" count={overdue.length}>
            <IssueLinkList issues={overdue} hrefFor={issueHref} showDueDate />
          </Section>
        ) : null}
        {repository ? <RepositorySection repository={repository} now={now} /> : null}
        <SessionsSection health={sessionHealth} now={now} />
        {answered.length > 0 ? (
          <RecentlyAnsweredSection
            questions={answered}
            issueTitles={issueTitles}
            basePath={basePath}
            now={now}
          />
        ) : null}
      </main>
    </div>
  )
}

// 答えを書きかけているときにリロードで消さないよう、入力中は再読み込みせず表示だけ出す
export function dashboardLiveReload(basePath: string): string {
  return `(()=>{const source=new EventSource(${JSON.stringify(`${basePath}/events`)});source.onmessage=()=>{const editing=[...document.querySelectorAll("textarea")].some((element)=>element.value.trim()!==""||element===document.activeElement);if(editing){document.getElementById("dashboard-stale")?.removeAttribute("hidden");return}location.reload()}})()`
}
