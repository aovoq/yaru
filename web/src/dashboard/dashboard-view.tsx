import { Alert } from "../components/alert"
import { AnsweredToast } from "../components/answered-toast"
import {
  AwaitingQuestionList,
  PROCEEDED_GROUP_ID,
  QUESTIONS_SECTION_ID,
  type AwaitingQuestionEntry,
  type ReturnedAnswer,
} from "../components/awaiting-question-list"
import { EmptyState } from "../components/empty-state"
import { issueLinkFor } from "../components/issue-link-for"
import { IssueLinkList } from "../components/issue-link-list"
import { isAwaitingAnswer } from "../components/question-answer"
import { PageHeader, type PageRefresh } from "../components/page-header"
import { PageShell } from "../components/page-shell"
import { Section } from "../components/section"
import { StatGrid } from "../components/stat-grid"
import { StatTile } from "../components/stat-tile"
import { isIssueOverdue } from "../domain/issue-dates"
import { groupAwaitingQuestions } from "../domain/group-questions"
import type { Issue } from "../domain/issue"
import type { Question } from "../domain/question"
import type { RepositoryState } from "../domain/repository"
import type { SessionHealth } from "../domain/session"
import { RecentlyAnsweredSection } from "./recently-answered-section"
import { RepositorySection } from "./repository-section"
import { sessionTouches } from "./session-touches"
import { SessionsSection } from "./sessions-section"
import { setSidebarOpen } from "./sidebar-gesture"
import { Sidebar } from "./sidebar"

// 質問に答えて進み具合を見る画面。見た目は src/dashboard.tsx。データは GetDashboard から渡す

const RECENTLY_ANSWERED_LIMIT = 10
const IN_PROGRESS_SECTION_ID = "in-progress"
const OVERDUE_SECTION_ID = "overdue"

const HIDDEN_REFRESH: PageRefresh = {
  hidden: true,
  label: "Updated — Show",
  onShow: () => {},
}

export type DashboardReturned = {
  question?: string
  error?: string
  answer?: string
}

export function DashboardView({
  questions,
  issues,
  now,
  sessionHealth,
  repository,
  basePath = "",
  workspaceName,
  error,
  returned,
  answered,
  drafts,
  revealAnchor,
  refresh = HIDDEN_REFRESH,
  onAnsweredExpire,
}: {
  questions: Question[]
  issues: Issue[]
  now: Date
  sessionHealth: SessionHealth
  repository: RepositoryState | null
  basePath?: string
  workspaceName?: string
  error?: string
  returned?: DashboardReturned
  answered?: Question | null
  drafts?: Readonly<Record<string, string>>
  revealAnchor?: string
  refresh?: PageRefresh
  onAnsweredExpire?: () => void
}) {
  const awaiting = questions.filter(isAwaitingAnswer)
  const expiredCount = awaiting.filter((question) => question.status === "expired").length
  const answeredQuestions = questions
    .filter((question) => question.status === "answered")
    .sort((left, right) => (right.answeredAt ?? "").localeCompare(left.answeredAt ?? ""))
    .slice(0, RECENTLY_ANSWERED_LIMIT)
  const inProgress = issues.filter((issue) => issue.status === "in_progress")
  const overdue = issues.filter((issue) => isIssueOverdue(issue, now))
  const issueTitles = new Map(issues.map((issue) => [issue.id, issue.title]))
  const issueHref = (issue: Issue) => `${basePath}/?id=${encodeURIComponent(issue.id)}`
  const groups = groupAwaitingQuestions(
    awaiting.map((question): AwaitingQuestionEntry => ({
      question,
      basePath,
      issueLink: issueLinkFor(question, issueTitles, basePath),
    })),
    (entry) => entry.question,
  )
  const returnedToCard = awaiting.some((question) => question.id === returned?.question)
  const returnedAnswer: ReturnedAnswer | undefined =
    returned?.question && returnedToCard
      ? { anchor: `q-${returned.question}`, error: returned.error, answer: returned.answer }
      : undefined
  const topError = returnedToCard ? error : (returned?.error ?? error)
  return (
    <PageShell
      sidebar={<Sidebar issues={issues} questions={questions} basePath={basePath} />}
      header={
        <PageHeader
          sidebarToggle
          onOpenSidebar={() => setSidebarOpen(true)}
          refresh={refresh}
          breadcrumb={[
            ...(workspaceName
              ? [
                  { label: "Projects", href: "/" },
                  { label: workspaceName, href: `${basePath}/` },
                ]
              : [{ label: "Issues", href: `${basePath}/` }]),
            { label: "Dashboard" },
          ]}
        />
      }
    >
      {topError ? <Alert>{topError}</Alert> : null}
      <StatGrid>
        <StatTile
          label="Awaiting answer"
          value={awaiting.length}
          tone={awaiting.length > 0 ? "attention" : "plain"}
          href={awaiting.length > 0 ? `#${QUESTIONS_SECTION_ID}` : undefined}
        />
        <StatTile
          label="Expired"
          value={expiredCount}
          tone={expiredCount > 0 ? "danger" : "plain"}
          href={expiredCount > 0 ? `#${PROCEEDED_GROUP_ID}` : undefined}
        />
        <StatTile
          label="In progress"
          value={inProgress.length}
          tone="plain"
          href={inProgress.length > 0 ? `#${IN_PROGRESS_SECTION_ID}` : undefined}
        />
        <StatTile
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? "danger" : "plain"}
          href={overdue.length > 0 ? `#${OVERDUE_SECTION_ID}` : undefined}
        />
      </StatGrid>
      <AwaitingQuestionList
        groups={groups}
        now={now}
        returned={returnedAnswer}
        drafts={drafts}
        revealAnchor={revealAnchor}
      />
      <Section id={IN_PROGRESS_SECTION_ID} title="In progress" count={inProgress.length}>
        {inProgress.length === 0 ? (
          <EmptyState>Nothing in progress</EmptyState>
        ) : (
          <IssueLinkList issues={inProgress} hrefFor={issueHref} showDueDate showStale now={now} />
        )}
      </Section>
      {overdue.length > 0 ? (
        <Section id={OVERDUE_SECTION_ID} title="Overdue" count={overdue.length}>
          <IssueLinkList issues={overdue} hrefFor={issueHref} showDueDate now={now} />
        </Section>
      ) : null}
      {repository ? <RepositorySection repository={repository} now={now} /> : null}
      <SessionsSection
        health={sessionHealth}
        now={now}
        touches={sessionTouches(questions, issues, basePath)}
      />
      {answeredQuestions.length > 0 ? (
        <RecentlyAnsweredSection
          questions={answeredQuestions}
          issueTitles={issueTitles}
          basePath={basePath}
          now={now}
        />
      ) : null}
      {answered ? (
        <AnsweredToast
          question={answered}
          basePath={basePath}
          returnTo={`${basePath}/dashboard`}
          now={now}
          onExpire={onAnsweredExpire}
        />
      ) : null}
    </PageShell>
  )
}
