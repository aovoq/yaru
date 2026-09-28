import type { InboxQuery } from "../route"

// 受信箱の仮画面。中身は次の担当が GetInbox で描く (docs/spec/routes.md の SPA の /inbox)
export function InboxPage({ query, fragment }: { query: InboxQuery; fragment: string | null }) {
  return (
    <main data-screen="inbox">
      <h1 class="text-title">Inbox</h1>
      {query.workspace !== null ? <p data-workspace={query.workspace} /> : null}
      {query.questionId !== null ? <p data-question={query.questionId} /> : null}
      {query.error !== null ? <p data-error={query.error} /> : null}
      {query.answer !== null ? <p data-answer={query.answer} /> : null}
      {query.answered !== null ? <p data-answered={query.answered} /> : null}
      {fragment !== null ? <p data-fragment={fragment} /> : null}
    </main>
  )
}
