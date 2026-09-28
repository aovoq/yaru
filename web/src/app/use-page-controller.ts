import { useCallback, useEffect, useReducer, useRef } from "preact/hooks"
import { requiresDocumentReload } from "../route"
import type { BoardApi } from "../board/board-api"
import { deleteNewIssueParams } from "../board/view-model"
import type { Issue } from "../domain/issue"
import type { PageData, SaveInput } from "../board/page-data"
import { SaveRejectedError } from "../board/save-error"
import {
  createClientState,
  documentTitle,
  fieldChange,
  reduceClientState,
  unsavedChanges,
  withoutReturnedParams,
  type ClientState,
  type DraftField,
  type ReturnedDrafts,
} from "../board/state"

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
  retrySave: () => Promise<void>
  dismissError: () => void
  showError: (message: string) => void
  toggleBulkSelection: (issueId: string) => void
  selectBulkRange: (issueId: string, orderedIds: string[]) => void
  clearBulkSelection: () => void
}

const SAVED_VISIBLE_MS = 2000

export type PageControllerOptions = {
  api: BoardApi
  returnedDrafts?: ReturnedDrafts
  loadOnMount?: boolean
}

// 板の読み込みと保存。最初の表示は GetPage から取る (docs/spec/routes.md の「SPA が受け取る path」)
// ライブ更新は WatchWorkspace。最初の ready でも取り直す。その 1 回だけは、URL の誤りを消さない
export function usePageController(
  initialPage: PageData,
  options: PageControllerOptions,
): PageController {
  const { api, loadOnMount = false } = options
  const [state, dispatch] = useReducer(reduceClientState, initialPage, (page: PageData) =>
    createClientState(page, options.returnedDrafts ?? {}),
  )
  const latestState = useRef(state)
  latestState.current = state
  const automaticRetryUsed = useRef(false)
  const loadedSinceFailure = useRef(false)
  const requestSequence = useRef(0)
  const pendingCommits = useRef(new Set<string>())
  const silentErrorKeeps = useRef(1)
  const mountedLoad = useRef(false)
  const basePath = initialPage.basePath ?? ""

  const navigate = useCallback(
    async (href: string, historyMode: HistoryMode = "push", preserveDraft = false) => {
      const sequence = ++requestSequence.current
      const pageUrl = new URL(href, window.location.href)
      if (requiresDocumentReload(window.location.pathname, pageUrl.pathname)) {
        window.location.assign(pageUrl.href)
        return
      }
      try {
        let page = await api.loadPage(pageUrl.href)
        if (sequence !== requestSequence.current) return
        if (page.current === null && pageUrl.searchParams.has("id")) {
          pageUrl.searchParams.delete("id")
          if (historyMode === "none") window.history.replaceState(null, "", pageUrl)
        }
        if (historyMode === "push") window.history.pushState(null, "", pageUrl)
        if (historyMode === "replace") window.history.replaceState(null, "", pageUrl)
        const cleaned = withoutReturnedParams(window.location.href)
        if (cleaned !== null) window.history.replaceState(null, "", cleaned)
        if (
          historyMode === "none" &&
          preserveDraft &&
          page.error === undefined &&
          latestState.current.error !== undefined &&
          silentErrorKeeps.current > 0
        ) {
          silentErrorKeeps.current -= 1
          page = { ...page, error: latestState.current.error }
        }
        loadedSinceFailure.current = latestState.current.saveState === "failed"
        dispatch({ type: "pageLoaded", page, preserveDraft })
      } catch (error) {
        dispatch({ type: "requestFailed", message: errorMessage(error), retryable: true })
      }
    },
    [api],
  )

  useEffect(() => {
    const onPopState = () => void navigate(window.location.href, "none")
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [navigate])

  useEffect(() => {
    if (!loadOnMount || mountedLoad.current) return
    mountedLoad.current = true
    void navigate(window.location.href, "none")
  }, [loadOnMount, navigate])

  useEffect(() => {
    const abort = new AbortController()
    void api.subscribe(() => {
      void navigate(window.location.href, "none", true)
    }, abort.signal)
    const onOnline = () => {
      void navigate(window.location.href, "none", true)
    }
    window.addEventListener("online", onOnline)
    return () => {
      abort.abort()
      window.removeEventListener("online", onOnline)
    }
  }, [api, navigate])

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

  const saveCurrent = useCallback(async () => {
    const current = latestState.current.current
    if (!current) return
    const input: SaveInput = issueInput(current)
    dispatch({ type: "saveStarted" })
    try {
      const saved = await api.saveIssue(input)
      automaticRetryUsed.current = false
      dispatch({ type: "saveFinished" })
      if (current.id) {
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
  }, [api, navigate])

  const commitField = useCallback(
    async (field: DraftField, value: string) => {
      const saved = latestState.current.saved
      const current = latestState.current.current
      if (!current?.id || !saved || saved.id !== current.id) {
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
        await api.saveIssue({ id: saved.id, ...change })
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
    [api, navigate],
  )

  const patchIssue = useCallback(
    async (issueId: string, input: Partial<SaveInput>) => {
      try {
        await api.saveIssue({ ...input, id: issueId })
        await navigate(window.location.href, "none", true)
      } catch (error) {
        if (error instanceof SaveRejectedError) throw error
        dispatch({ type: "requestFailed", message: errorMessage(error) })
      }
    },
    [api, navigate],
  )

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
      await api.saveIssue({ id: current.id, ...changes })
      automaticRetryUsed.current = false
      dispatch({ type: "saveFinished" })
      await navigate(window.location.href, "none", true)
    } catch (error) {
      if (error instanceof SaveRejectedError) {
        dispatch({ type: "saveRejected", message: error.message })
        return
      }
      dispatch({ type: "saveFailed", message: errorMessage(error) })
    }
  }, [api, navigate, saveCurrent])

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
