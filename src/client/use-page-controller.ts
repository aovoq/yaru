import { useCallback, useEffect, useReducer, useRef } from "preact/hooks"
import type { PageData } from "../page"
import type { Issue, SaveInput } from "../store"
import {
  createClientState,
  documentTitle,
  fieldChange,
  reduceClientState,
  unsavedChanges,
  type ClientState,
  type DraftField,
  type ReturnedDrafts,
} from "./state"
import { deleteNewIssueParams } from "./view-model"

type HistoryMode = "push" | "replace" | "none"

export type PageController = {
  state: ClientState
  navigate: (href: string, historyMode?: HistoryMode, preserveDraft?: boolean) => Promise<void>
  changeDraft: (field: DraftField, value: string) => void
  selectIssue: (issueId: string | null) => void
  saveCurrent: () => Promise<void>
  commitField: (field: DraftField, value: string) => Promise<void>
  moveIssue: (issueId: string, status: string) => Promise<void>
  patchIssue: (issueId: string, input: Partial<SaveInput>) => Promise<void>
  // 自動保存に失敗して残っている変更を、まとめて保存し直す。issue 画面の Retry から呼ぶ
  retrySave: () => Promise<void>
  dismissError: () => void
  // 呼んだ側で受けた失敗 (メニューからの保存を断られたなど) を、画面の誤りとして出す
  showError: (message: string) => void
  toggleBulkSelection: (issueId: string) => void
  selectBulkRange: (issueId: string, orderedIds: string[]) => void
  clearBulkSelection: () => void
}

// Saved を出しておく長さ。保存できたことが目に入れば十分で、出し続けると次の変更の Unsaved と紛れる
const SAVED_VISIBLE_MS = 2000

export function usePageController(
  initialPage: PageData,
  returnedDrafts: ReturnedDrafts = {},
): PageController {
  const [state, dispatch] = useReducer(reduceClientState, initialPage, (page: PageData) =>
    createClientState(page, returnedDrafts),
  )
  // 非同期の処理の途中で最新の状態を読むために、描くたびに最新の状態を持たせておく
  const latestState = useRef(state)
  latestState.current = state
  // 保存に失敗したあとの自動のやり直しは 1 回だけにする。保存が通ったら次の失敗に備えて戻す
  const automaticRetryUsed = useRef(false)
  const loadedSinceFailure = useRef(false)
  const requestSequence = useRef(0)
  // select は 1 回の変更で input と change の両方を出すので、同じ項目・同じ値の保存が重ならないよう、送っている最中のものを覚えておく
  const pendingCommits = useRef(new Set<string>())
  const basePath = initialPage.basePath ?? ""

  const navigate = useCallback(
    async (href: string, historyMode: HistoryMode = "push", preserveDraft = false) => {
      const sequence = ++requestSequence.current
      const pageUrl = new URL(href, window.location.href)
      try {
        const response = await fetch(`${basePath}/api/page${pageUrl.search}`, { cache: "no-store" })
        const page = await pageData(response)
        if (sequence !== requestSequence.current) return
        // 消えた issue へのリンクは、板と誤りを返す (404)。id を URL に残すと、読み直すたびに同じ誤りが出直すので落とす
        if (page.current === null && pageUrl.searchParams.has("id")) {
          pageUrl.searchParams.delete("id")
          if (historyMode === "none") window.history.replaceState(null, "", pageUrl)
        }
        if (historyMode === "push") window.history.pushState(null, "", pageUrl)
        if (historyMode === "replace") window.history.replaceState(null, "", pageUrl)
        loadedSinceFailure.current = latestState.current.saveState === "failed"
        dispatch({ type: "pageLoaded", page, preserveDraft })
      } catch (error) {
        dispatch({ type: "requestFailed", message: errorMessage(error), retryable: true })
      }
    },
    [basePath],
  )

  useEffect(() => {
    const onPopState = () => void navigate(window.location.href, "none")
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [navigate])

  useEffect(() => {
    const events = new EventSource(`${basePath}/events`)
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let disconnected = false
    const refresh = () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void navigate(window.location.href, "none", true), 80)
    }
    events.onmessage = refresh
    // 接続が切れていた間の変更は届かないので、つながり直したら読み直す。保存に失敗した変更のやり直しもこの読み直しのあとに行う
    // https://html.spec.whatwg.org/multipage/server-sent-events.html#sse-processing-model
    events.onerror = () => {
      disconnected = true
    }
    events.onopen = () => {
      if (!disconnected) return
      disconnected = false
      refresh()
    }
    window.addEventListener("online", refresh)
    return () => {
      clearTimeout(refreshTimer)
      events.close()
      window.removeEventListener("online", refresh)
    }
  }, [basePath, navigate])

  useEffect(() => {
    document.title = documentTitle(state.current, basePath)
  }, [state.current?.id, state.current?.title, basePath])

  useEffect(() => {
    if (state.saveState !== "saved") return
    const timer = setTimeout(() => dispatch({ type: "saveFaded" }), SAVED_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [state.saveState])

  const changeDraft = useCallback((field: DraftField, value: string) => {
    dispatch({ type: "draftChanged", field, value })
  }, [])

  const selectIssue = useCallback((issueId: string | null) => {
    dispatch({ type: "issueSelected", issueId })
  }, [])

  // ⌘⏎ や Create で下書き全体を保存する。既存の issue は開いたまま、新しい issue は作った issue を開く
  const saveCurrent = useCallback(async () => {
    if (!state.current) return
    const input: SaveInput = issueInput(state.current)
    dispatch({ type: "saveStarted" })
    try {
      const saved = await postIssue(basePath, input)
      automaticRetryUsed.current = false
      dispatch({ type: "saveFinished" })
      if (state.current.id) {
        await navigate(window.location.href, "none", true)
        return
      }
      const pageUrl = new URL(window.location.href)
      deleteNewIssueParams(pageUrl)
      pageUrl.searchParams.set("id", saved.id)
      await navigate(pageUrl.href, "replace")
    } catch (error) {
      if (error instanceof SaveRejectedError) {
        dispatch({ type: "saveRejected", message: error.message })
        return
      }
      dispatch({ type: "saveFailed", message: errorMessage(error) })
    }
  }, [basePath, navigate, state.current])

  // Linear のように、属性は変えたとき、文字の欄は離れたときにその項目だけを保存する
  // 保存済みの値と同じなら書き込まない。新しい issue は Create まで保存しない
  // サーバーが値を受け付けなかった (4xx) ときは、その項目を保存済みの値に戻し、理由を持った Error で断る。理由はその項目の近くに出す
  // 届かなかった (通信が切れた・5xx) ときは、手元の値を残して保存の失敗 (failed) にし、つながり直したら送り直す。このときは断らない
  const commitField = useCallback(
    async (field: DraftField, value: string) => {
      const saved = state.saved
      if (!state.current?.id || !saved || saved.id !== state.current.id) {
        dispatch({ type: "draftChanged", field, value })
        return
      }
      const change = fieldChange(saved, field, value)
      if (!change) return
      const commitKey = `${saved.id}\u0000${field}\u0000${JSON.stringify(change)}`
      if (pendingCommits.current.has(commitKey)) return
      pendingCommits.current.add(commitKey)
      dispatch({ type: "draftChanged", field, value })
      dispatch({ type: "saveStarted" })
      try {
        await postIssue(basePath, { id: saved.id, ...change })
        automaticRetryUsed.current = false
        dispatch({ type: "saveFinished" })
        await navigate(window.location.href, "none", true)
      } catch (error) {
        if (error instanceof SaveRejectedError) {
          dispatch({ type: "fieldReverted", field })
          throw error
        }
        dispatch({ type: "saveFailed", message: errorMessage(error) })
      } finally {
        pendingCommits.current.delete(commitKey)
      }
    },
    [basePath, navigate, state.current, state.saved],
  )

  // 板や右クリックから、開いていない issue の一部の項目だけを保存する
  // 受け付けなかった (4xx) ときは理由を持った Error で断り、呼んだ側がその場で理由を出す。届かなかったときは全体の誤りとして出す
  const patchIssue = useCallback(
    async (issueId: string, input: Partial<SaveInput>) => {
      try {
        await postIssue(basePath, { ...input, id: issueId })
        await navigate(window.location.href, "none", true)
      } catch (error) {
        if (error instanceof SaveRejectedError) throw error
        dispatch({ type: "requestFailed", message: errorMessage(error) })
      }
    },
    [basePath, navigate],
  )

  // 板の上で動かした issue の状態を保存する。動かした先の近くに理由を出す場所が無いので、断られた理由も全体の誤りとして出す
  const moveIssue = useCallback(
    async (issueId: string, status: string) => {
      try {
        await patchIssue(issueId, { status })
      } catch (error) {
        dispatch({ type: "requestFailed", message: errorMessage(error) })
      }
    },
    [patchIssue],
  )

  const showError = useCallback((message: string) => {
    dispatch({ type: "requestFailed", message })
  }, [])

  // 保存済みの版と違う項目を 1 回で送り直す。新しい issue はまだ無いので、作成をやり直す
  const retrySave = useCallback(async () => {
    const { current, saved } = latestState.current
    if (!current) return
    if (!current.id) {
      await saveCurrent()
      return
    }
    if (!saved || saved.id !== current.id) return
    const changes = unsavedChanges(current, saved)
    if (Object.keys(changes).length === 0) return
    dispatch({ type: "saveStarted" })
    try {
      await postIssue(basePath, { id: current.id, ...changes })
      automaticRetryUsed.current = false
      dispatch({ type: "saveFinished" })
      await navigate(window.location.href, "none", true)
    } catch (error) {
      // 送り直した値を受け付けなかったときは、どの項目が理由かを分けられないので、下書きを残して理由を出す
      if (error instanceof SaveRejectedError) {
        dispatch({ type: "saveRejected", message: error.message })
        return
      }
      dispatch({ type: "saveFailed", message: errorMessage(error) })
    }
  }, [basePath, navigate, saveCurrent])

  // 保存に失敗したあと、読み込みが通った (つながり直した) ら、残っている変更を 1 度だけ自動で送り直す
  // 新しい issue は、人が Create を押し直すまで作らない。勝手に作ると、同じ issue が 2 つできたと思わせるため
  useEffect(() => {
    if (!loadedSinceFailure.current) return
    loadedSinceFailure.current = false
    if (state.saveState !== "failed" || !state.draftDirty || !state.current?.id) return
    if (automaticRetryUsed.current) return
    automaticRetryUsed.current = true
    void retrySave()
  }, [state, retrySave])

  const dismissError = useCallback(() => dispatch({ type: "errorDismissed" }), [])
  const toggleBulkSelection = useCallback(
    (issueId: string) => dispatch({ type: "bulkToggled", issueId }),
    [],
  )
  const selectBulkRange = useCallback(
    (issueId: string, orderedIds: string[]) =>
      dispatch({ type: "bulkRangeSelected", issueId, orderedIds }),
    [],
  )
  const clearBulkSelection = useCallback(() => dispatch({ type: "bulkCleared" }), [])

  return {
    state,
    navigate,
    changeDraft,
    selectIssue,
    saveCurrent,
    commitField,
    moveIssue,
    patchIssue,
    retrySave,
    dismissError,
    showError,
    toggleBulkSelection,
    selectBulkRange,
    clearBulkSelection,
  }
}

// サーバーが入力を受け付けなかったこと (4xx)。届かなかった失敗 (通信が切れた・5xx) と分けて扱う
// 受け付けなかった値は送り直しても通らないので、項目を戻して理由を出す。届かなかった値は残して送り直す
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5
export class SaveRejectedError extends Error {}

async function postIssue(basePath: string, input: Partial<SaveInput>): Promise<Issue> {
  const response = await fetch(`${basePath}/api/issues`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  if (response.ok) return (await response.json()) as Issue
  const message = await responseError(response)
  if (response.status >= 400 && response.status < 500) throw new SaveRejectedError(message)
  throw new Error(message)
}

// 消えた issue を開いたときは 404 でも板の中身 (PageData) が返るので、それは読み込めたものとして扱う
async function pageData(response: Response): Promise<PageData> {
  if (response.ok) return (await response.json()) as PageData
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  if (response.status === 404 && body !== null && Array.isArray((body as PageData).issues)) {
    return body as PageData
  }
  throw new Error(
    typeof body?.error === "string"
      ? body.error
      : `request failed: expected successful response, actual ${response.status}`,
  )
}

function issueInput(issue: Issue): SaveInput {
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

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === "string"
    ? body.error
    : `request failed: expected successful response, actual ${response.status}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
