import { DEFAULT_VIEW, type PageData } from "../page"
import type { Issue, SaveInput } from "../store"
import { pageTitle } from "../ui/page-title"

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

// 自動保存の状態。画面の上に Saving… / Saved / 保存できなかったこと (failed) を出すのに使う
// failed は保存に失敗し、手元にまだ保存していない変更が残っている間だけ続く。やり直しの保存が通るか、別の issue を開くと戻る
export type SaveState = "idle" | "saving" | "saved" | "failed"

// フォームの POST (コメントと回答) が失敗して板へ戻されたとき、URL に載って返ってきた書きかけの文
// issue 画面がコメント欄と回答欄に入れ直すのに使う。サーバーは ?comment= か ?q=<質問の id>&answer= で返す (src/web.tsx)
export type ReturnedDrafts = {
  comment?: string
  answer?: { questionId: string; text: string }
}

export type ClientState = PageData & {
  // 最後に読み込んだ、保存済みの issue。自動保存で値が変わったかどうかを比べるのに使う
  saved: Issue | null
  saveState: SaveState
  selectedIssueId: string | null
  draftDirty: boolean
  labelInput: string
  blockInput: string
  requestError?: string
  // requestError が読み込みの失敗で、読み込み直せば直るものか。値を断られた誤りや届かなかった保存では、読み込み直しても直らない
  requestRetryable: boolean
  returnedDrafts: ReturnedDrafts
  // x と Shift+クリックでまとめて選んだ issue の id (選んだ順)。下の帯からまとめて属性を変える
  bulkSelection: string[]
  // Shift+クリックで範囲を選ぶときの起点。最後に x で付け外しした issue
  bulkAnchor: string | null
}

export type ClientAction =
  | { type: "pageLoaded"; page: PageData; preserveDraft: boolean }
  | { type: "draftChanged"; field: DraftField; value: string }
  | { type: "issueSelected"; issueId: string | null }
  | { type: "requestFailed"; message: string; retryable?: boolean }
  | { type: "saveStarted" }
  | { type: "saveFinished" }
  | { type: "saveFailed"; message: string }
  // サーバーが値を受け付けなかった (4xx)。その項目は保存済みの値に戻し、理由は項目の近くに出すので全体の誤りにはしない
  | { type: "fieldReverted"; field: DraftField }
  // 新しい issue の作成や、まとめての保存し直しをサーバーが受け付けなかった (4xx)。下書きは残し、理由を出す
  | { type: "saveRejected"; message: string }
  | { type: "saveFaded" }
  | { type: "errorDismissed" }
  | { type: "bulkToggled"; issueId: string }
  | { type: "bulkRangeSelected"; issueId: string; orderedIds: string[] }
  | { type: "bulkCleared" }

export function createClientState(
  page: Omit<PageData, "view"> & { view?: PageData["view"] },
  returnedDrafts: ReturnedDrafts = {},
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
    requestRetryable: false,
    returnedDrafts,
    bulkSelection: [],
    bulkAnchor: null,
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
    // 別の issue を開いたり閉じたりしたら、前の issue の保存の様子や書きかけの文を持ち越さない
    const sameIssue = state.current !== null && server !== null && state.current.id === server.id
    const existingIds = new Set(action.page.all.map((issue) => issue.id))
    const bulkSelection = state.bulkSelection.filter((issueId) => existingIds.has(issueId))
    return {
      ...action.page,
      current: preserveCurrent ? merged : server,
      saved: action.page.current,
      saveState: sameIssue ? state.saveState : "idle",
      returnedDrafts: sameIssue ? state.returnedDrafts : {},
      bulkSelection,
      bulkAnchor:
        state.bulkAnchor !== null && existingIds.has(state.bulkAnchor) ? state.bulkAnchor : null,
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
      requestRetryable: false,
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
  if (action.type === "fieldReverted") {
    if (!state.current || !state.saved || state.saved.id !== state.current.id) return state
    const current = { ...state.current, [action.field]: state.saved[action.field] }
    return {
      ...state,
      current,
      saveState: "idle",
      draftDirty: isDirty(current, state.saved),
      labelInput: action.field === "labels" ? state.saved.labels.join(", ") : state.labelInput,
      blockInput: action.field === "blocks" ? state.saved.blocks.join(", ") : state.blockInput,
    }
  }
  if (action.type === "saveRejected") {
    return { ...state, saveState: "idle", requestError: action.message, requestRetryable: false }
  }
  if (action.type === "saveFailed") {
    return { ...state, saveState: "failed", requestError: action.message, requestRetryable: false }
  }
  // Saved は少し出したら消す。その間に次の保存が始まっていたら、その様子は消さない
  if (action.type === "saveFaded") {
    return state.saveState === "saved" ? { ...state, saveState: "idle" } : state
  }
  if (action.type === "errorDismissed") {
    return { ...state, error: undefined, requestError: undefined, requestRetryable: false }
  }
  if (action.type === "bulkToggled") {
    const selected = state.bulkSelection.includes(action.issueId)
    return {
      ...state,
      bulkSelection: selected
        ? state.bulkSelection.filter((issueId) => issueId !== action.issueId)
        : [...state.bulkSelection, action.issueId],
      bulkAnchor: action.issueId,
    }
  }
  if (action.type === "bulkRangeSelected") {
    return {
      ...state,
      bulkSelection: selectRange(
        state.bulkSelection,
        action.orderedIds,
        state.bulkAnchor ?? action.issueId,
        action.issueId,
      ),
      bulkAnchor: state.bulkAnchor ?? action.issueId,
    }
  }
  if (action.type === "bulkCleared") return { ...state, bulkSelection: [], bulkAnchor: null }
  // 読み込みの失敗は保存の様子を変えない。保存の最中に別の読み込み (他の人の書き込みの反映) が落ちても、Saving… を消さないため
  return { ...state, requestError: action.message, requestRetryable: action.retryable === true }
}

// 起点から押した issue までを、画面に並んだ順で今の選択に足す。起点が画面に無ければ押した issue だけを足す
function selectRange(
  selection: string[],
  orderedIds: string[],
  anchorId: string,
  targetId: string,
): string[] {
  const targetIndex = orderedIds.indexOf(targetId)
  if (targetIndex < 0) return selection
  const anchorIndex = orderedIds.indexOf(anchorId)
  const start = anchorIndex < 0 ? targetIndex : Math.min(anchorIndex, targetIndex)
  const end = anchorIndex < 0 ? targetIndex : Math.max(anchorIndex, targetIndex)
  const added = orderedIds.slice(start, end + 1).filter((issueId) => !selection.includes(issueId))
  return [...selection, ...added]
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

// 保存済みの issue と違う項目を、1 回で送れる保存の入力にまとめる。自動保存に失敗したあとのやり直しに使う
export function unsavedChanges(draft: Issue, saved: Issue): Partial<SaveInput> {
  const changes: Partial<Record<DraftField, unknown>> = {}
  for (const field of EDITABLE_FIELDS) {
    if (!sameValue(field, draft[field], saved[field])) changes[field] = draft[field]
  }
  return changes as Partial<SaveInput>
}

const RETURNED_PARAMS = ["error", "comment", "q", "answer"] as const

// フォームの失敗で戻された URL から、書きかけの文を取り出す。回答は質問の id と組のときだけ使う
export function readReturnedDrafts(search: string): ReturnedDrafts {
  const parameters = new URLSearchParams(search)
  const drafts: ReturnedDrafts = {}
  const comment = parameters.get("comment")
  if (comment !== null) drafts.comment = comment
  const questionId = parameters.get("q")
  const answer = parameters.get("answer")
  if (questionId && answer !== null) drafts.answer = { questionId, text: answer }
  return drafts
}

// 読み取った後は URL から落とす。残すと、読み直しや共有した URL でまた同じ誤りと文が出てしまう
// #q-<id> の飛び先は残す。落とすものが無ければ null を返し、履歴を書き換えない
export function withoutReturnedParams(href: string): string | null {
  const url = new URL(href)
  if (!RETURNED_PARAMS.some((name) => url.searchParams.has(name))) return null
  for (const name of RETURNED_PARAMS) url.searchParams.delete(name)
  return url.href
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

// タブと履歴に出す名前。「#73 題名 · ワークスペース · yaru」、issue を開いていなければ「ワークスペース · yaru」
// 板の中の移動はページを読み直さないので、サーバーが最初に付けた <title> を画面の側で付け直す。並べ方はサーバーと同じ pageTitle に任せる
export function documentTitle(current: Issue | null, basePath: string): string {
  const workspace = basePath.startsWith("/p/") ? decodeURIComponent(basePath.slice(3)) : null
  const issue = current
    ? current.id
      ? `#${current.id} ${current.title.trim()}`
      : "New issue"
    : null
  return pageTitle(issue, workspace)
}
