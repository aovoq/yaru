import { Sidebar } from "./client/board/sidebar"
import { Alert } from "./components/alert"
import {
  AwaitingQuestionList,
  PROCEEDED_GROUP_ID,
  QUESTIONS_SECTION_ID,
  type AwaitingQuestionEntry,
  type ReturnedAnswer,
} from "./components/awaiting-question-list"
import { EmptyState } from "./components/empty-state"
import { IssueLinkList } from "./components/issue-link-list"
import { isAwaitingAnswer } from "./components/question-answer"
import { Section } from "./components/section"
import { StatGrid } from "./components/stat-grid"
import { StatTile } from "./components/stat-tile"
import { labelColors } from "./components/tint"
import { issueLinkFor } from "./components/issue-link-for"
import { RecentlyAnsweredSection } from "./dashboard/recently-answered-section"
import { RepositorySection } from "./dashboard/repository-section"
import { sessionTouches } from "./dashboard/session-touches"
import { SessionsSection } from "./dashboard/sessions-section"
import { isIssueOverdue } from "./issue-dates"
import { summarizeAwaiting } from "./page"
import { groupAwaitingQuestions, type Question } from "./questions"
import type { RepositoryState } from "./repository"
import type { SessionHealth } from "./sessions"
import type { Issue } from "./store"
import { AnsweredToast } from "./ui/answered-toast"
import { PageHeader } from "./ui/page-header"
import { PageShell } from "./ui/page-shell"

// 人が離れた場所 (主にスマホ) から、エージェントの質問に答えて進み具合を見るための画面
// 板 (BoardPage) と違ってクライアントのハイドレーションを持たず、フォームの POST と inline script (ui/live-page.ts) だけで動かす

export type DashboardData = {
  questions: Question[]
  issues: Issue[]
  now: Date
  sessionHealth: SessionHealth
  repository: RepositoryState | null
  // 1 つの yaru serve で複数のワークスペースを配るときの、このワークスペースの URL の接頭辞。単独なら ""
  basePath?: string
  // 見出しの道筋 (Projects › <名前> › Dashboard) に出すワークスペースの名前
  workspaceName?: string
  // 画面の上に出す失敗の理由
  error?: string
  // 失敗したフォームから戻ってきたときの、どの質問か・理由・書きかけ (?q=&error=&answer=)
  // 答え待ちのカードがあればその中に戻し、無ければ (別の場所で答えられたなど) 理由を画面の上に出す
  returned?: { question?: string; error?: string; answer?: string }
  // 答えた直後に戻ってきたときの、答えた質問 (?answered=)。取り消しの知らせを出す
  answered?: Question | null
}

const RECENTLY_ANSWERED_LIMIT = 10

// 件数の札から飛ぶ先のまとまり
const IN_PROGRESS_SECTION_ID = "in-progress"
const OVERDUE_SECTION_ID = "overdue"

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
  returned,
  answered,
}: DashboardData) {
  const awaiting = questions.filter(isAwaitingAnswer)
  const expiredCount = awaiting.filter((question) => question.status === "expired").length
  const answeredQuestions = questions
    .filter((question) => question.status === "answered")
    .sort((a, b) => (b.answeredAt ?? "").localeCompare(a.answeredAt ?? ""))
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
      sidebar={
        <Sidebar
          all={issues}
          filters={{ basePath }}
          awaitingQuestionCount={awaiting.length}
          awaitingByIssue={summarizeAwaiting(awaiting)}
          labelColors={labelColors(issues.flatMap((issue) => issue.labels))}
          active="dashboard"
        />
      }
      header={
        <PageHeader
          sidebarToggle
          refresh
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
      <AwaitingQuestionList groups={groups} now={now} returned={returnedAnswer} />
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
        />
      ) : null}
    </PageShell>
  )
}
