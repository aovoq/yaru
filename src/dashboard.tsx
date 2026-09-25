import { Alert } from "./components/alert"
import { EmptyState } from "./components/empty-state"
import { HeaderBar } from "./components/header-bar"
import { IssueLinkList } from "./components/issue-link-list"
import { LogoLink } from "./components/logo-link"
import { Pill } from "./components/pill"
import { isAwaitingAnswer } from "./components/question-answer"
import { Section } from "./components/section"
import { StatGrid } from "./components/stat-grid"
import { StatTile } from "./components/stat-tile"
import { TextLink } from "./components/text-link"
import { AwaitingQuestionsSection } from "./dashboard/awaiting-questions-section"
import { RecentlyAnsweredSection } from "./dashboard/recently-answered-section"
import { RepositorySection } from "./dashboard/repository-section"
import { SessionsSection } from "./dashboard/sessions-section"
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
      <HeaderBar sticky>
        <LogoLink />
        {workspaceName ? <TextLink href="/">{workspaceName}</TextLink> : null}
        <h1 class="text-[13px] font-medium text-ink">Dashboard</h1>
        <Pill id="dashboard-stale" hidden class="ml-2">
          Updated. Reload after answering.
        </Pill>
        <TextLink href={`${basePath}/`} size="xs" class="ml-auto">
          Issues
        </TextLink>
      </HeaderBar>
      <main class="mx-auto flex max-w-2xl flex-col gap-8 px-4 pt-4 pb-16">
        {error ? <Alert>{error}</Alert> : null}
        <StatGrid>
          <StatTile
            label="Awaiting answer"
            value={awaiting.length}
            tone={awaiting.length > 0 ? "attention" : "plain"}
          />
          <StatTile
            label="Expired"
            value={expiredCount}
            tone={expiredCount > 0 ? "danger" : "plain"}
          />
          <StatTile label="In progress" value={inProgress.length} tone="plain" />
          <StatTile
            label="Overdue"
            value={overdue.length}
            tone={overdue.length > 0 ? "danger" : "plain"}
          />
        </StatGrid>
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

// web.tsx は dashboard の入口からまとめて読み込むので、ここから出し直す
export { dashboardLiveReload } from "./dashboard/live-reload"
