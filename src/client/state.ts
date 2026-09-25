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
    const server = action.page.current
    // 自動保存や他の人の書き込みで読み直したとき、手元で変えた項目は手元の値を、それ以外は読み直した値を使う
    // 保存の途中で別の欄に打ち始めた文字を、読み直しで消さないため
    const merged =
      action.preserveDraft &&
      state.current &&
      state.saved &&
      server &&
      state.current.id === server.id
        ? mergeDraft(state.current, state.saved, server)
        : null
    const preserveCurrent = merged !== null && isDirty(merged, server!)
    const selectedIssueId = action.page.issues.some((issue) => issue.id === state.selectedIssueId)
      ? state.selectedIssueId
      : null
    return {
      ...action.page,
      current: preserveCurrent ? merged : server,
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
      comments: action.page.comments ?? [],
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
  // 保存が終わっても、手元にまだ保存していない変更があるかは読み直したときに比べて決める
  if (action.type === "saveFinished") return { ...state, saveState: "saved" }
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

const EDITABLE_FIELDS: DraftField[] = [
  "title",
  "status",
  "assignee",
  "labels",
  "dueDate",
  "priority",
  "parent",
  "blocks",
  "body",
]

// 手元の下書き・前に読んだ版・読み直した版の 3 つを比べ、手元で変えた項目だけ手元の値を残す
function mergeDraft(draft: Issue, previous: Issue, server: Issue): Issue {
  const merged: Issue = { ...server }
  for (const field of EDITABLE_FIELDS) {
    if (!sameValue(field, draft[field], previous[field])) {
      ;(merged as Record<DraftField, unknown>)[field] = draft[field]
    }
  }
  return merged
}

function isDirty(draft: Issue, server: Issue): boolean {
  return EDITABLE_FIELDS.some((field) => !sameValue(field, draft[field], server[field]))
}

// 題名はサーバーが前後の空白を落として保存するので、空白の違いは変更と見なさない
function sameValue(field: DraftField, left: unknown, right: unknown): boolean {
  if (field === "title" && typeof left === "string" && typeof right === "string") {
    return left.trim() === right.trim()
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index])
  }
  return left === right
}
