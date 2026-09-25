import { Alert } from "./components/alert"
import {
  AwaitingQuestionList,
  type AwaitingQuestionEntry,
  type ReturnedAnswer,
} from "./components/awaiting-question-list"
import { issueLinkFor } from "./components/issue-link-for"
import type { Inbox } from "./inbox"
import type { Question } from "./questions"
import { AnsweredToast } from "./ui/answered-toast"
import { PageHeader } from "./ui/page-header"
import { PageShell } from "./ui/page-shell"

// 全ワークスペースの答えを待っている質問を 1 画面に集めた受信箱 (/inbox)
// 人は複数のプロジェクトのエージェントを並べて動かすので、ワークスペースごとの dashboard を順に開かずに、先に答えるべき質問から答えられるようにする
// 並べ方は dashboard と同じまとまり (Blocking・Due soon・No deadline・Proceeded) で、ワークスペースをまたいで混ぜてから分ける (inbox.ts)
// 答えはその質問のワークスペースへ送り、送ったあとはこの画面へ戻す (returnTo=/inbox)
// 質問の番号はワークスペースごとなので、カードとフォームの id にワークスペースの名前を挟む (question-answer.ts の scope)

export const INBOX_PATH = "/inbox"

export type InboxPageData = {
  inbox: Inbox
  now: Date
  // 失敗したフォームから戻ってきたときの、どのワークスペースのどの質問か・理由・書きかけ (?workspace=&q=&error=&answer=)
  returned?: { workspace?: string; question?: string; error?: string; answer?: string }
  // 答えた直後に戻ってきたときの、答えた質問とそのワークスペースの URL の接頭辞 (?answered=&workspace=)
  answered?: { question: Question; basePath: string } | null
}

const NO_ISSUE_TITLES: ReadonlyMap<string, string> = new Map()

export function InboxPage({ inbox, now, returned, answered }: InboxPageData) {
  const entries = (items: Inbox["groups"]["blocking"]) =>
    items.map((item): AwaitingQuestionEntry => ({
      question: item.question,
      basePath: item.basePath,
      scope: item.workspace,
      workspace: { name: item.workspace, href: item.href },
      // 受信箱は issue の題名を読まないので、番号だけのリンクにする
      issueLink: issueLinkFor(item.question, NO_ISSUE_TITLES, item.basePath),
      returnTo: INBOX_PATH,
    }))
  const groups = {
    blocking: entries(inbox.groups.blocking),
    dueSoon: entries(inbox.groups.dueSoon),
    noDeadline: entries(inbox.groups.noDeadline),
    proceeded: entries(inbox.groups.proceeded),
  }
  const returnedItem = Object.values(inbox.groups)
    .flat()
    .find(
      (item) => item.workspace === returned?.workspace && item.question.id === returned?.question,
    )
  const returnedAnswer: ReturnedAnswer | undefined = returnedItem
    ? { anchor: returnedItem.anchor, error: returned?.error, answer: returned?.answer }
    : undefined
  return (
    <PageShell
      header={
        <PageHeader refresh breadcrumb={[{ label: "Projects", href: "/" }, { label: "Inbox" }]} />
      }
    >
      {returned?.error && !returnedItem ? <Alert>{returned.error}</Alert> : null}
      <AwaitingQuestionList
        groups={groups}
        now={now}
        returned={returnedAnswer}
        emptyText="No questions awaiting an answer in any workspace"
      />
      {answered ? (
        <AnsweredToast
          question={answered.question}
          basePath={answered.basePath}
          returnTo={INBOX_PATH}
          now={now}
        />
      ) : null}
    </PageShell>
  )
}
