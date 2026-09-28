import { BoardScreen } from "../app/board-screen"
import type { BoardApi } from "../board/board-api"
import type { BoardQuery } from "../route"

// 板。中身は BoardScreen が GetPage で描く (docs/spec/routes.md の SPA の /p/:slug/)
export function BoardPage({
  slug,
  query,
  fragment,
  api,
}: {
  slug: string
  query: BoardQuery
  fragment: string | null
  api?: BoardApi
}) {
  return <BoardScreen slug={slug} query={query} fragment={fragment} api={api} />
}
