// SPA が受け取る path。docs/spec/routes.md の「SPA が受け取る path」
// /p/:slug に末尾のスラッシュが無くても板として開く。登録に無ければ 404。今の 302 はしない (src/web.tsx:562)

const CARD_FRAGMENT = /^[A-Za-z][A-Za-z0-9._-]*$/

export type Route =
  | { name: "projects" }
  | { name: "inbox" }
  | { name: "board"; slug: string; registration: "known" | "pending" }
  | { name: "dashboard"; slug: string; registration: "known" | "pending" }
  | { name: "terminal" }
  | { name: "not-found" }

export function matchPath(pathname: string, knownSlugs?: ReadonlySet<string>): Route {
  if (pathname === "/") return { name: "projects" }
  if (pathname === "/inbox") return { name: "inbox" }
  // 端末だけ style-src に unsafe-inline が要る。文書の path を他の画面と分ける
  // docs/spec/security.md の「決定 (2026-09-28)」
  if (pathname === "/terminal") return { name: "terminal" }

  const dashboard = /^\/p\/([^/]+)\/dashboard$/.exec(pathname)
  if (dashboard) {
    const slug = decodeSlug(dashboard[1]!)
    if (slug === null) return { name: "not-found" }
    return workspaceRoute("dashboard", slug, knownSlugs)
  }

  const board = /^\/p\/([^/]+)\/?$/.exec(pathname)
  if (board) {
    const slug = decodeSlug(board[1]!)
    if (slug === null) return { name: "not-found" }
    return workspaceRoute("board", slug, knownSlugs)
  }

  return { name: "not-found" }
}

function decodeSlug(segment: string): string | null {
  let slug: string
  try {
    slug = decodeURIComponent(segment)
  } catch {
    return null
  }
  if (slug === "" || slug === "." || slug === ".." || slug.includes("/") || slug.includes("\\")) {
    return null
  }
  return slug
}

function workspaceRoute(
  name: "board" | "dashboard",
  slug: string,
  knownSlugs: ReadonlySet<string> | undefined,
): Route {
  if (knownSlugs === undefined) return { name, slug, registration: "pending" }
  if (!knownSlugs.has(slug)) return { name: "not-found" }
  return { name, slug, registration: "known" }
}

export type InboxQuery = {
  workspace: string | null
  questionId: string | null
  error: string | null
  answer: string | null
  answered: string | null
}

export function readInboxQuery(search: string): InboxQuery {
  return {
    workspace: parameter(search, "workspace"),
    questionId: parameter(search, "q"),
    error: parameter(search, "error"),
    answer: parameter(search, "answer"),
    answered: parameter(search, "answered"),
  }
}

export type DashboardQuery = {
  questionId: string | null
  error: string | null
  answer: string | null
  answered: string | null
}

export function readDashboardQuery(search: string): DashboardQuery {
  return {
    questionId: parameter(search, "q"),
    error: parameter(search, "error"),
    answer: parameter(search, "answer"),
    answered: parameter(search, "answered"),
  }
}

// 板の query。docs/spec/routes.md の GET /p/:slug/。comment、q、answer は PageData に入らない (src/client/state.ts:233)
export type BoardQuery = {
  query: string | null
  id: string | null
  status: string | null
  assignee: string | null
  label: string | null
  awaiting: string | null
  sort: string | null
  group: string | null
  completed: string | null
  view: string | null
  newStatus: string | null
  newParent: string | null
  newLabel: string | null
  newAssignee: string | null
  error: string | null
  comment: string | null
  questionId: string | null
  answer: string | null
}

export function readBoardQuery(search: string): BoardQuery {
  return {
    query: parameter(search, "query"),
    id: parameter(search, "id"),
    status: parameter(search, "status"),
    assignee: parameter(search, "assignee"),
    label: parameter(search, "label"),
    awaiting: parameter(search, "awaiting"),
    sort: parameter(search, "sort"),
    group: parameter(search, "group"),
    completed: parameter(search, "completed"),
    view: parameter(search, "view"),
    newStatus: parameter(search, "new_status"),
    newParent: parameter(search, "new_parent"),
    newLabel: parameter(search, "new_label"),
    newAssignee: parameter(search, "new_assignee"),
    error: parameter(search, "error"),
    comment: parameter(search, "comment"),
    questionId: parameter(search, "q"),
    answer: parameter(search, "answer"),
  }
}

function parameter(search: string, name: string): string | null {
  const normalized = search.startsWith("?") ? search.slice(1) : search
  return new URLSearchParams(normalized).get(name)
}

// カードへ移す fragment は src/web.tsx:752-754 と同じく、この正規表現に合うものだけ
export function cardFragment(hash: string): string | null {
  const value = hash.startsWith("#") ? hash.slice(1) : hash
  if (!CARD_FRAGMENT.test(value)) return null
  return value
}
