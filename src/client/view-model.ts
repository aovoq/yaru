import { DEFAULT_VIEW, type ViewMode } from "../page"
import { STATUSES, type Issue, type Priority } from "../store"

export type PageFilters = {
  query?: string
  status?: string
  assignee?: string
  label?: string
  view?: ViewMode
}

export function pageHref(filters: PageFilters, id?: string): string {
  const parameters = new URLSearchParams()
  if (filters.query) parameters.set("query", filters.query)
  if (filters.status) parameters.set("status", filters.status)
  if (filters.assignee) parameters.set("assignee", filters.assignee)
  if (filters.label) parameters.set("label", filters.label)
  if (filters.view && filters.view !== DEFAULT_VIEW) parameters.set("view", filters.view)
  if (id) parameters.set("id", id)
  const query = parameters.toString()
  return query ? `/?${query}` : "/"
}

export function newIssueHref(filters: PageFilters, status?: string): string {
  const base = pageHref(filters, "new")
  if (!status) return base
  return `${base}${base.includes("?") ? "&" : "?"}new_status=${encodeURIComponent(status)}`
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

export function priorityLabel(priority: Priority): string {
  return priority.replace(/^\w/, (character) => character.toUpperCase())
}
