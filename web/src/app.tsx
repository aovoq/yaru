import { BoardPage } from "./pages/board-page"
import { DashboardPage } from "./pages/dashboard-page"
import { InboxPage } from "./pages/inbox-page"
import { NotFoundPage } from "./pages/not-found-page"
import { ProjectsPage } from "./pages/projects-page"
import { TerminalPage } from "./terminal/terminal-page"
import {
  cardFragment,
  matchPath,
  readBoardQuery,
  readDashboardQuery,
  readInboxQuery,
} from "./route"

// 経路と仮画面をつなぐ。板や dashboard の中身は次の担当
// knownSlugs が無いあいだは、ワークスペースの path を pending のまま出す。一覧が来たら渡して、無い slug は 404 にする
export function App({ href, knownSlugs }: { href: string; knownSlugs?: ReadonlySet<string> }) {
  const url = new URL(href)
  const route = matchPath(url.pathname, knownSlugs)
  const fragment = cardFragment(url.hash)
  return (
    <div class="h-dvh overflow-hidden bg-canvas pt-safe font-sans text-body text-ink antialiased scheme-dark">
      {route.name === "projects" ? <ProjectsPage /> : null}
      {route.name === "inbox" ? (
        <InboxPage query={readInboxQuery(url.search)} fragment={fragment} />
      ) : null}
      {route.name === "board" ? (
        <BoardPage slug={route.slug} query={readBoardQuery(url.search)} fragment={fragment} />
      ) : null}
      {route.name === "dashboard" ? (
        <DashboardPage
          slug={route.slug}
          query={readDashboardQuery(url.search)}
          fragment={fragment}
        />
      ) : null}
      {route.name === "terminal" ? <TerminalPage /> : null}
      {route.name === "not-found" ? <NotFoundPage /> : null}
    </div>
  )
}
