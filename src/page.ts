import { getIssue, listIssues, type Issue, type Store } from "./store"

export const BLANK: Issue = {
  id: "",
  title: "",
  status: "todo",
  assignee: null,
  labels: [],
  dueDate: null,
  priority: null,
  parent: null,
  blocks: [],
  blockedBy: [],
  children: [],
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  createdAt: "",
  updatedAt: "",
  body: "",
}

export const DEFAULT_VIEW = "list"

export type ViewMode = "board" | "list"

export function parseView(raw?: string): ViewMode {
  return raw === "board" ? "board" : "list"
}

export type PageData = {
  issues: Issue[]
  all: Issue[]
  query: string
  current: Issue | null
  status?: string
  assignee?: string
  label?: string
  view: ViewMode
  error?: string
}

export function getPageData(store: Store, url: URL): PageData {
  const query = url.searchParams.get("query") || ""
  const id = url.searchParams.get("id") || undefined
  const status = url.searchParams.get("status") || undefined
  const assignee = url.searchParams.get("assignee") || undefined
  const label = url.searchParams.get("label") || undefined
  const view = parseView(url.searchParams.get("view") || undefined)
  const issues = listIssues(store, {
    query: query || undefined,
    status,
    assignee,
    label,
  })
  const current =
    id === "new"
      ? { ...BLANK, status: url.searchParams.get("new_status") || status || "todo" }
      : id
        ? getIssue(store, id)
        : null
  return {
    issues,
    all: listIssues(store),
    query,
    current,
    status,
    assignee,
    label,
    view,
  }
}
