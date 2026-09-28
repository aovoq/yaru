import type { BoardQuery } from "../route"

// 板の仮画面。中身は次の担当が GetPage で描く (docs/spec/routes.md の SPA の /p/:slug/)
export function BoardPage({
  slug,
  query,
  fragment,
}: {
  slug: string
  query: BoardQuery
  fragment: string | null
}) {
  return (
    <main data-screen="board" data-slug={slug}>
      <h1 class="text-title">{slug}</h1>
      {query.id !== null ? <p data-issue={query.id} /> : null}
      {query.error !== null ? <p data-error={query.error} /> : null}
      {fragment !== null ? <p data-fragment={fragment} /> : null}
    </main>
  )
}
