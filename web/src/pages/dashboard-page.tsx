import { DashboardScreen } from "../dashboard/dashboard-screen"
import type { DashboardQuery } from "../route"

// /p/<slug>/dashboard。中身は web/src/dashboard
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
    <div
      class="contents"
      data-screen="dashboard"
      data-slug={slug}
      data-question={query.questionId ?? undefined}
      data-error={query.error ?? undefined}
      data-answer={query.answer ?? undefined}
      data-answered={query.answered ?? undefined}
      data-fragment={fragment ?? undefined}
    >
      <DashboardScreen slug={slug} query={query} fragment={fragment} />
    </div>
  )
}
