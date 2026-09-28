import type { DashboardQuery } from "../route"

// dashboard の仮画面。中身は次の担当が GetDashboard で描く (docs/spec/routes.md の SPA の /p/:slug/dashboard)
export function DashboardPage({
  slug,
  query,
  fragment,
}: {
  slug: string
  query: DashboardQuery
  fragment: string | null
}) {
  return (
    <main data-screen="dashboard" data-slug={slug}>
      <h1 class="text-title">Dashboard</h1>
      {query.questionId !== null ? <p data-question={query.questionId} /> : null}
      {query.error !== null ? <p data-error={query.error} /> : null}
      {query.answer !== null ? <p data-answer={query.answer} /> : null}
      {query.answered !== null ? <p data-answered={query.answered} /> : null}
      {fragment !== null ? <p data-fragment={fragment} /> : null}
    </main>
  )
}
