import { STATUSES, type Issue } from "../domain/issue"
import type { BoardQuery } from "../route"
import type { IssuePage, PageFilters, ReturnedDrafts } from "./model"

// 板の URL。src/client/view-model.ts の pageHref と同じく、既定の見せ方は載せない

export const DEFAULT_SORT = "priority"
export const DEFAULT_GROUP = "status"
export const DEFAULT_COMPLETED = "recent"
export const DEFAULT_VIEW = "list"

const RETURNED_PARAMS = ["error", "comment", "q", "answer"] as const

export function pageHref(filters: PageFilters, id?: string): string {
  const parameters = new URLSearchParams()
  if (filters.query) parameters.set("query", filters.query)
  if (filters.status) parameters.set("status", filters.status)
  if (filters.assignee) parameters.set("assignee", filters.assignee)
  if (filters.label) parameters.set("label", filters.label)
  if (filters.awaiting) parameters.set("awaiting", "1")
  if (filters.sort && filters.sort !== DEFAULT_SORT) parameters.set("sort", filters.sort)
  if (filters.group && filters.group !== DEFAULT_GROUP) parameters.set("group", filters.group)
  if (filters.completed && filters.completed !== DEFAULT_COMPLETED) {
    parameters.set("completed", filters.completed)
  }
  if (filters.view && filters.view !== DEFAULT_VIEW) parameters.set("view", filters.view)
  if (id) parameters.set("id", id)
  const query = parameters.toString()
  const base = filters.basePath ?? ""
  return query ? `${base}/?${query}` : `${base}/`
}

// 完了と取りやめの列を開いたとき、サーバーが completed を all に固定して返す
// それをそのまま載せると、別の列へ移ったときに人が選んでいない all が URL に残るので載せない
export function pageFilters(
  page: Pick<
    IssuePage,
    "query" | "status" | "assignee" | "label" | "awaiting" | "display" | "view" | "basePath"
  >,
): PageFilters {
  const finishedColumn = page.status === "done" || page.status === "canceled"
  return {
    query: page.query || undefined,
    status: page.status,
    assignee: page.assignee,
    label: page.label,
    awaiting: page.awaiting,
    sort: page.display.sort,
    group: page.display.group,
    completed: finishedColumn ? undefined : page.display.completed,
    view: page.view,
    basePath: page.basePath,
  }
}

// 新しい issue を作る画面へのリンク。今のラベルと担当者の絞り込みを渡し、作った issue が絞り込みから消えないようにする
export function newIssueHref(filters: PageFilters, status?: string, parent?: string): string {
  const url = new URL(pageHref(filters, "new"), "http://yaru.local")
  if (status) url.searchParams.set("new_status", status)
  if (parent) url.searchParams.set("new_parent", parent)
  if (filters.label) url.searchParams.set("new_label", filters.label)
  if (filters.assignee) url.searchParams.set("new_assignee", filters.assignee)
  return `${url.pathname}${url.search}`
}

export function deleteNewIssueParams(url: URL): void {
  for (const name of ["new_status", "new_parent", "new_label", "new_assignee"]) {
    url.searchParams.delete(name)
  }
}

export function issueColumns(issues: Issue[]): string[] {
  const extraStatuses: string[] = []
  for (const issue of issues) {
    if (
      !(STATUSES as readonly string[]).includes(issue.status) &&
      !extraStatuses.includes(issue.status)
    ) {
      extraStatuses.push(issue.status)
    }
  }
  return [...STATUSES, ...extraStatuses]
}

export function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

export function priorityLabel(priority: string): string {
  return priority.replace(/^\w/, (character) => character.toUpperCase())
}

export function documentTitle(issueId: string, title: string, workspace: string): string {
  const issue = issueId ? `#${issueId} ${title.trim()}` : "New issue"
  return [issue, workspace, "yaru"].filter((part) => part !== "").join(" · ")
}

// 板の query から、書きかけのコメントと回答を取り出す。回答は質問の id と組のときだけ使う
export function draftsFromQuery(query: BoardQuery): ReturnedDrafts {
  const drafts: ReturnedDrafts = {}
  if (query.comment !== null) drafts.comment = query.comment
  const questionId = query.questionId
  if (questionId && query.answer !== null) drafts.answer = { questionId, text: query.answer }
  return drafts
}

export function hasReturnedParams(query: BoardQuery): boolean {
  return (
    query.error !== null ||
    query.comment !== null ||
    query.questionId !== null ||
    query.answer !== null
  )
}

// 読み取ったあとに URL から落とす。残すと、読み直しや共有した URL でまた同じ誤りと文が出る
export function withoutReturnedParams(href: string): string | null {
  const url = new URL(href, "http://yaru.local")
  const search = url.searchParams
  if (!RETURNED_PARAMS.some((name) => search.has(name))) return null
  for (const name of RETURNED_PARAMS) search.delete(name)
  const query = search.toString()
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`
}
