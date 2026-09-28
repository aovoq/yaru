import type { Issue } from "../domain/issue"
import { pageFilters } from "./filters"
import type { DraftField, IssuePage, ReturnedDrafts, SaveInput, SaveState } from "./model"

// issue 画面の下書き。板のまとめて選択は持たない。比べ方は src/client/state.ts と同じ

export type ClientState = {
  current: Issue | null
  saved: Issue | null
  all: Issue[]
  comments: IssuePage["comments"]
  questions: IssuePage["questions"]
  events: IssuePage["events"]
  commits: IssuePage["commits"]
  filters: ReturnType<typeof pageFilters>
  viewer: string
  error?: string
  saveState: SaveState
  draftDirty: boolean
  requestError?: string
  returnedDrafts: ReturnedDrafts
  now: string
}

export type ClientAction =
  | { type: "pageLoaded"; page: IssuePage; preserveDraft: boolean }
  | { type: "draftChanged"; field: DraftField; value: string }
  | { type: "saveStarted" }
  | { type: "saveFinished" }
  | { type: "saveFailed"; message: string }
  | { type: "fieldReverted"; field: DraftField }
  | { type: "saveRejected"; message: string }
  | { type: "saveFaded" }
  | { type: "errorDismissed" }
  | { type: "requestFailed"; message: string }
  | { type: "commentsChanged"; comments: IssuePage["comments"] }

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

export function createClientState(
  page: IssuePage,
  returnedDrafts: ReturnedDrafts = {},
): ClientState {
  return {
    current: page.current,
    saved: page.current,
    all: page.all,
    comments: page.comments,
    questions: page.questions,
    events: page.events,
    commits: page.commits,
    filters: pageFilters(page),
    viewer: page.viewer,
    error: page.error,
    saveState: "idle",
    draftDirty: false,
    returnedDrafts,
    now: page.now,
  }
}

export function reduceClientState(state: ClientState, action: ClientAction): ClientState {
  if (action.type === "pageLoaded") {
    const server = action.page.current
    const merged =
      action.preserveDraft &&
      state.current &&
      state.saved &&
      server &&
      state.current.id === server.id
        ? mergeDraft(state.current, state.saved, server)
        : null
    const preserveCurrent = merged !== null && server !== null && isDirty(merged, server)
    const sameIssue = state.current !== null && server !== null && state.current.id === server.id
    return {
      current: preserveCurrent ? merged : server,
      saved: server,
      all: action.page.all,
      comments: action.page.comments,
      questions: action.page.questions,
      events: action.page.events,
      commits: action.page.commits,
      filters: pageFilters(action.page),
      viewer: action.page.viewer,
      error: preserveCurrent ? state.error : action.page.error,
      saveState: sameIssue ? state.saveState : "idle",
      returnedDrafts: sameIssue ? state.returnedDrafts : {},
      draftDirty: preserveCurrent,
      requestError: undefined,
      now: action.page.now,
    }
  }
  if (action.type === "draftChanged") {
    if (!state.current) return state
    return {
      ...state,
      current: updateDraft(state.current, action.field, action.value),
      draftDirty: true,
      error: undefined,
      requestError: undefined,
    }
  }
  if (action.type === "saveStarted") return { ...state, saveState: "saving" }
  if (action.type === "saveFinished") return { ...state, saveState: "saved" }
  if (action.type === "fieldReverted") {
    if (!state.current || !state.saved || state.saved.id !== state.current.id) return state
    const current = revertField(state.current, state.saved, action.field)
    return {
      ...state,
      current,
      saveState: "idle",
      draftDirty: isDirty(current, state.saved),
    }
  }
  if (action.type === "saveRejected") {
    return { ...state, saveState: "idle", requestError: action.message }
  }
  if (action.type === "saveFailed") {
    return { ...state, saveState: "failed", requestError: action.message }
  }
  if (action.type === "saveFaded") {
    return state.saveState === "saved" ? { ...state, saveState: "idle" } : state
  }
  if (action.type === "errorDismissed") {
    return { ...state, error: undefined, requestError: undefined }
  }
  if (action.type === "commentsChanged") return { ...state, comments: action.comments }
  return { ...state, requestError: action.message }
}

// 閉じる前に「変更を捨てるか」を聞くべきか
// 既存の issue は項目ごとに自動で保存するので、保存の最中は聞かない。保存に失敗して残っている変更があるときは聞く
// 新しい issue は Create まで保存しないので、題名か説明を書いていれば聞く。属性だけを選んだ状態は捨てても惜しくない
export function hasUnsavedChanges(state: ClientState): boolean {
  const current = state.current
  if (!current) return false
  if (!current.id) return current.title.trim() !== "" || current.body.trim() !== ""
  return state.draftDirty && state.saveState !== "saving"
}

export function unsavedChanges(draft: Issue, saved: Issue): Partial<SaveInput> {
  const changes: Partial<Record<DraftField, unknown>> = {}
  for (const field of EDITABLE_FIELDS) {
    if (!sameValue(field, draft[field], saved[field])) changes[field] = draft[field]
  }
  return changes as Partial<SaveInput>
}

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

export function issueInput(issue: Issue): SaveInput {
  return {
    id: issue.id || undefined,
    title: issue.title,
    status: issue.status,
    assignee: issue.assignee,
    labels: issue.labels,
    dueDate: issue.dueDate,
    priority: issue.priority,
    parent: issue.parent,
    blocks: issue.blocks,
    body: issue.body,
  }
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

function revertField(current: Issue, saved: Issue, field: DraftField): Issue {
  if (field === "labels") return { ...current, labels: saved.labels }
  if (field === "blocks") return { ...current, blocks: saved.blocks }
  if (field === "assignee") return { ...current, assignee: saved.assignee }
  if (field === "dueDate") return { ...current, dueDate: saved.dueDate }
  if (field === "priority") return { ...current, priority: saved.priority }
  if (field === "parent") return { ...current, parent: saved.parent }
  if (field === "title") return { ...current, title: saved.title }
  if (field === "status") return { ...current, status: saved.status }
  return { ...current, body: saved.body }
}

function mergeDraft(draft: Issue, previous: Issue, server: Issue): Issue {
  const merged: Issue = { ...server }
  for (const field of EDITABLE_FIELDS) {
    if (!sameValue(field, draft[field], previous[field])) {
      assignField(merged, field, draft)
    }
  }
  return merged
}

function assignField(target: Issue, field: DraftField, source: Issue): void {
  if (field === "labels") target.labels = source.labels
  else if (field === "blocks") target.blocks = source.blocks
  else if (field === "assignee") target.assignee = source.assignee
  else if (field === "dueDate") target.dueDate = source.dueDate
  else if (field === "priority") target.priority = source.priority
  else if (field === "parent") target.parent = source.parent
  else if (field === "title") target.title = source.title
  else if (field === "status") target.status = source.status
  else target.body = source.body
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
