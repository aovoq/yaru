import { DEFAULT_VIEW, type PageData } from "../page"
import type { Issue, SaveInput } from "../store"

export type DraftField =
  | "title"
  | "status"
  | "assignee"
  | "labels"
  | "dueDate"
  | "priority"
  | "parent"
  | "blocks"
  | "body"

// 自動保存の状態。画面の上に Saving… / Saved を出すのに使う
export type SaveState = "idle" | "saving" | "saved"

export type ClientState = PageData & {
  // 最後に読み込んだ、保存済みの issue。自動保存で値が変わったかどうかを比べるのに使う
  saved: Issue | null
  saveState: SaveState
  selectedIssueId: string | null
  draftDirty: boolean
  labelInput: string
  blockInput: string
  requestError?: string
}

export type ClientAction =
  | { type: "pageLoaded"; page: PageData; preserveDraft: boolean }
  | { type: "draftChanged"; field: DraftField; value: string }
  | { type: "issueSelected"; issueId: string | null }
  | { type: "requestFailed"; message: string }
  | { type: "saveStarted" }
  | { type: "saveFinished" }

export function createClientState(
  page: Omit<PageData, "view"> & { view?: PageData["view"] },
): ClientState {
  return {
    ...page,
    view: page.view ?? DEFAULT_VIEW,
    saved: page.current,
    saveState: "idle",
    selectedIssueId: null,
    draftDirty: false,
    labelInput: page.current?.labels.join(", ") ?? "",
    blockInput: page.current?.blocks.join(", ") ?? "",
    comments: page.comments ?? [],
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
      saved: action.page.current,
      saveState: state.saveState,
      error: preserveCurrent ? state.error : action.page.error,
      selectedIssueId,
      draftDirty: preserveCurrent,
      labelInput: preserveCurrent
        ? state.labelInput
        : (action.page.current?.labels.join(", ") ?? ""),
      blockInput: preserveCurrent
        ? state.blockInput
        : (action.page.current?.blocks.join(", ") ?? ""),
      comments: preserveCurrent ? state.comments : (action.page.comments ?? []),
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
      blockInput: action.field === "blocks" ? action.value : state.blockInput,
      error: undefined,
      requestError: undefined,
    }
  }
  if (action.type === "issueSelected") {
    return { ...state, selectedIssueId: action.issueId }
  }
  if (action.type === "saveStarted") return { ...state, saveState: "saving" }
  if (action.type === "saveFinished") return { ...state, saveState: "saved", draftDirty: false }
  return { ...state, saveState: "idle", requestError: action.message }
}

function updateDraft(issue: Issue, field: DraftField, value: string): Issue {
  if (field === "labels" || field === "blocks") {
    return {
      ...issue,
      [field]: value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    }
  }
  if (field === "assignee" || field === "dueDate" || field === "priority" || field === "parent") {
    return { ...issue, [field]: value || null }
  }
  return { ...issue, [field]: value }
}

// 入力欄の文字列を、保存済みの issue と比べて変わっていれば保存用の入力にする。変わっていなければ null
export function fieldChange(
  saved: Issue,
  field: DraftField,
  value: string,
): Partial<SaveInput> | null {
  const next = updateDraft(saved, field, value)
  const before = saved[field]
  const after = next[field]
  const same =
    Array.isArray(before) && Array.isArray(after)
      ? before.length === after.length && before.every((item, index) => item === after[index])
      : before === after
  if (same) return null
  return { [field]: after } as Partial<SaveInput>
}
