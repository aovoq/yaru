import { Alert } from "../components/alert"
import { AnsweredToast } from "../components/answered-toast"
import {
  AwaitingQuestionList,
  type AwaitingQuestionEntry,
  type ReturnedAnswer,
} from "../components/awaiting-question-list"
import { issueLinkFor } from "../components/issue-link-for"
import { PageHeader, type PageRefresh } from "../components/page-header"
import { PageShell } from "../components/page-shell"
import type { Question } from "../domain/question"

// 全ワークスペースの答え待ちを 1 画面に集める。src/inbox-page.tsx

export const INBOX_PATH = "/inbox"

const HIDDEN_REFRESH: PageRefresh = {
  hidden: true,
  label: "Updated — Show",
  onShow: () => {},
}

const NO_ISSUE_TITLES: ReadonlyMap<string, string> = new Map()

export type InboxItem = {
  workspace: string
  basePath: string
  href: string
  anchor: string
  question: Question
}

export type InboxGroups = {
  blocking: InboxItem[]
  dueSoon: InboxItem[]
  noDeadline: InboxItem[]
  proceeded: InboxItem[]
}

export type InboxData = {
  groups: InboxGroups
  workspaces: { slug: string; basePath: string; awaiting: number }[]
}

export type InboxReturned = {
  workspace?: string
  question?: string
  error?: string
  answer?: string
}

export function InboxView({
  inbox,
  now,
  returned,
  answered,
  drafts,
  revealAnchor,
  refresh = HIDDEN_REFRESH,
  onAnsweredExpire,
}: {
  inbox: InboxData
  now: Date
  returned?: InboxReturned
  answered?: { question: Question; basePath: string } | null
  drafts?: Readonly<Record<string, string>>
  revealAnchor?: string
  refresh?: PageRefresh
  onAnsweredExpire?: () => void
}) {
  const entries = (items: InboxItem[]) =>
    items.map((item): AwaitingQuestionEntry => ({
      question: item.question,
      basePath: item.basePath,
      scope: item.workspace,
      workspace: { name: item.workspace, href: item.href },
      issueLink: issueLinkFor(item.question, NO_ISSUE_TITLES, item.basePath),
      returnTo: INBOX_PATH,
    }))
  const groups = {
    blocking: entries(inbox.groups.blocking),
    dueSoon: entries(inbox.groups.dueSoon),
    noDeadline: entries(inbox.groups.noDeadline),
    proceeded: entries(inbox.groups.proceeded),
  }
  const returnedItem = allItems(inbox).find(
    (item) => item.workspace === returned?.workspace && item.question.id === returned?.question,
  )
  const returnedAnswer: ReturnedAnswer | undefined = returnedItem
    ? { anchor: returnedItem.anchor, error: returned?.error, answer: returned?.answer }
    : undefined
  return (
    <PageShell
      header={
        <PageHeader
          refresh={refresh}
          breadcrumb={[{ label: "Projects", href: "/" }, { label: "Inbox" }]}
        />
      }
    >
      {returned?.error && !returnedItem ? <Alert>{returned.error}</Alert> : null}
      <AwaitingQuestionList
        groups={groups}
        now={now}
        returned={returnedAnswer}
        drafts={drafts}
        revealAnchor={revealAnchor}
        emptyText="No questions awaiting an answer in any workspace"
      />
      {answered ? (
        <AnsweredToast
          question={answered.question}
          basePath={answered.basePath}
          returnTo={INBOX_PATH}
          now={now}
          onExpire={onAnsweredExpire}
        />
      ) : null}
    </PageShell>
  )
}

export function allItems(inbox: InboxData): InboxItem[] {
  return [
    ...inbox.groups.blocking,
    ...inbox.groups.dueSoon,
    ...inbox.groups.noDeadline,
    ...inbox.groups.proceeded,
  ]
}

export function inboxAnchors(inbox: InboxData): string[] {
  return allItems(inbox).map((item) => item.anchor)
}
