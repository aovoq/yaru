import { DEFAULT_VIEW, type PageData } from "../page"
import type { Issue } from "../store"

export type DraftField =
  | "title"
  | "status"
  | "assignee"
  | "labels"
  | "dueDate"
  | "priority"
  | "body"

export type ClientState = PageData & {
  selectedIssueId: string | null
  draftDirty: boolean
  labelInput: string
  requestError?: string
}

export type ClientAction =
  | { type: "pageLoaded"; page: PageData; preserveDraft: boolean }
  | { type: "draftChanged"; field: DraftField; value: string }
  | { type: "issueSelected"; issueId: string | null }
  | { type: "requestFailed"; message: string }

export function createClientState(
  page: Omit<PageData, "view"> & { view?: PageData["view"] },
): ClientState {
  return {
    ...page,
    view: page.view ?? DEFAULT_VIEW,
    selectedIssueId: null,
    draftDirty: false,
    labelInput: page.current?.labels.join(", ") ?? "",
  }
}

export function reduceClientState(state: ClientState, action: ClientAction): ClientState {
  if (action.type === "pageLoaded") {
    const preserveCurrent = action.preserveDraft && state.draftDirty
    const selectedIssueId = action.page.issues.some((issue) => issue.id === state.selectedIssueId)
      ? state.selectedIssueId
      : null
    return {
      ...action.page,
      current: preserveCurrent ? state.current : action.page.current,
      error: preserveCurrent ? state.error : action.page.error,
      selectedIssueId,
      draftDirty: preserveCurrent,
      labelInput: preserveCurrent
        ? state.labelInput
        : (action.page.current?.labels.join(", ") ?? ""),
      requestError: undefined,
    }
  }
  if (action.type === "draftChanged") {
    if (!state.current) return state
    return {
      ...state,
      current: updateDraft(state.current, action.field, action.value),
      draftDirty: true,
      labelInput: action.field === "labels" ? action.value : state.labelInput,
      error: undefined,
      requestError: undefined,
    }
  }
  if (action.type === "issueSelected") {
    return { ...state, selectedIssueId: action.issueId }
  }
  return { ...state, requestError: action.message }
}

function updateDraft(issue: Issue, field: DraftField, value: string): Issue {
  if (field === "labels") {
    return {
      ...issue,
      labels: value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    }
  }
  if (field === "assignee" || field === "dueDate" || field === "priority") {
    return { ...issue, [field]: value || null }
  }
  return { ...issue, [field]: value }
}
