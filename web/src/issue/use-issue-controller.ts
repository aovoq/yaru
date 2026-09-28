import { useCallback, useEffect, useReducer, useRef } from "preact/hooks"
import type { Transport } from "@connectrpc/connect"
import { subscribeWorkspace } from "../connect/watch"
import type { QuestionStatus } from "../gen/yaru/v1/common_pb"
import type { BoardQuery } from "../route"
import {
  createClientState,
  fieldChange,
  issueInput,
  reduceClientState,
  unsavedChanges,
  type ClientAction,
  type ClientState,
} from "./draft-state"
import { deleteNewIssueParams, documentTitle, draftsFromQuery, hasReturnedParams, pageFilters, pageHref, withoutReturnedParams } from "./filters"
import type { Comment, DraftField, SaveInput } from "./model"
import {
  commentFromProto,
  getPageInit,
  issueFromProto,
  pageFromResponse,
  saveIssueInit,
  serverNow,
  type GetPageInit,
  type PageResponse,
  type SaveIssueInit,
} from "./proto"
import { SaveRejectedError, errorText, saveFailure } from "./save-error"

// issue 画面の読み込みと保存。板は URL を渡し、ここが GetPage と SaveIssue を呼ぶ
// ライブ更新で読み直したとき、手元で変えた項目だけを残す

const SAVED_VISIBLE_MS = 2000

export type IssueClients = {
  page: { getPage(request: GetPageInit): Promise<PageResponse> }
  issues: { saveIssue(request: SaveIssueInit): Promise<{ issue?: PageResponse["current"]; now: string }> }
  comments: {
    saveComment(request: { workspace: string; issue?: string; body?: string }): Promise<{
      comment?: Parameters<typeof commentFromProto>[0]
    }>
  }
  questions: {
    answerQuestion(request: {
      workspace: string
      id: string
      body?: string
      expectedStatus?: QuestionStatus
      force?: boolean
    }): Promise<{ question?: PageResponse["questions"][number]; now: string }>
    undoAnswer(request: {
      workspace: string
      id: string
      answeredAt?: string
    }): Promise<{ question?: PageResponse["questions"][number]; now: string }>
    cancelQuestion(request: {
      workspace: string
      id: string
    }): Promise<{ question?: PageResponse["questions"][number]; now: string }>
  }
  transport?: Transport
}

type ScreenAction = ClientAction | { type: "replace"; state: ClientState }

function reduce(state: ClientState | null, action: ScreenAction): ClientState | null {
  if (action.type === "replace") return action.state
  if (!state) return state
  return reduceClientState(state, action)
}

export function useIssueController({
  workspace,
  issueId,
  query,
  clients,
  onNavigate,
  onUnavailable,
  watch,
}: {
  workspace: string
  issueId: string
  query: BoardQuery
  clients: IssueClients
  onNavigate: (href: string, mode: "push" | "replace") => void
  onUnavailable?: (message: string) => void
  watch?: (refetch: () => void) => () => void
}) {
  const [state, dispatch] = useReducer(reduce, null)
  const [loadError, setLoadError] = useReducer(
    (_current: string | null, next: string | null) => next,
    null,
  )
  const latest = useRef(state)
  latest.current = state
  const returnedDrafts = useRef(draftsFromQuery(query))
  const includeReturned = useRef(true)
  const automaticRetryUsed = useRef(false)
  const loadedSinceFailure = useRef(false)
  const requestSequence = useRef(0)
  const pendingCommits = useRef(new Set<string>())
  const reportedMissing = useRef<string | null>(null)
  const navigate = useRef(onNavigate)
  navigate.current = onNavigate
  const unavailable = useRef(onUnavailable)
  unavailable.current = onUnavailable
  const clientsRef = useRef(clients)
  clientsRef.current = clients
  const queryRef = useRef(query)
  queryRef.current = query

  const filterKey = [
    workspace,
    issueId,
    query.query,
    query.status,
    query.assignee,
    query.label,
    query.awaiting,
    query.sort,
    query.group,
    query.completed,
    query.view,
    query.newStatus,
    query.newParent,
    query.newLabel,
    query.newAssignee,
  ].join("\0")

  const load = useCallback(
    async (preserveDraft: boolean) => {
      const sequence = ++requestSequence.current
      const requestQuery = includeReturned.current ? queryRef.current : withoutReturned(queryRef.current)
      includeReturned.current = false
      try {
        const response = await clientsRef.current.page.getPage(
          getPageInit(workspace, issueId, requestQuery),
        )
        if (sequence !== requestSequence.current) return
        const page = pageFromResponse(response)
        serverNow(page.now)
        if (!page.current) {
          if (reportedMissing.current !== issueId) {
            reportedMissing.current = issueId
            unavailable.current?.(page.error ?? `issue not found: ${issueId}`)
            const filters = pageFilters({
              ...page,
              basePath: page.basePath || basePathOf(workspace),
            })
            navigate.current(pageHref(filters), "replace")
          }
          dispatch({ type: "replace", state: createClientState({ ...page, current: null }, {}) })
          setLoadError(null)
          return
        }
        setLoadError(null)
        const current = latest.current
        if (!current || !current.current) {
          dispatch({
            type: "replace",
            state: createClientState(page, returnedDrafts.current),
          })
          return
        }
        loadedSinceFailure.current = current.saveState === "failed"
        dispatch({ type: "pageLoaded", page, preserveDraft })
      } catch (error) {
        if (sequence !== requestSequence.current) return
        setLoadError(errorText(error))
      }
    },
    [filterKey, issueId, workspace],
  )

  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    reportedMissing.current = null
    void load(false)
  }, [load])

  useEffect(() => {
    if (!hasReturnedParams(query)) return
    const href = withoutReturnedParams(addressOf(workspace, issueId, query))
    if (href) navigate.current(href, "replace")
  }, [issueId, query, workspace])

  useEffect(() => {
    const refetch = () => void loadRef.current(true)
    if (watch) return watch(refetch)
    const transport = clients.transport
    if (!transport) return
    const controller = new AbortController()
    void subscribeWorkspace({
      transport,
      workspace,
      refetch,
      signal: controller.signal,
    })
    return () => controller.abort()
  }, [clients.transport, watch, workspace])

  useEffect(() => {
    const current = state?.current
    if (!current) return
    const previous = document.title
    document.title = documentTitle(current.id, current.title, workspace)
    return () => {
      document.title = previous
    }
  }, [state?.current?.id, state?.current?.title, workspace])

  useEffect(() => {
    if (state?.saveState !== "saved") return
    const timer = setTimeout(() => dispatch({ type: "saveFaded" }), SAVED_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [state?.saveState])

  const reload = useCallback(async () => {
    await loadRef.current(true)
  }, [])

  const changeDraft = useCallback((field: DraftField, value: string) => {
    dispatch({ type: "draftChanged", field, value })
  }, [])

  const saveCurrent = useCallback(async () => {
    const current = latest.current?.current
    if (!current) return
    dispatch({ type: "saveStarted" })
    try {
      const saved = await clientsRef.current.issues.saveIssue(
        saveIssueInit(workspace, issueInput(current)),
      )
      automaticRetryUsed.current = false
      dispatch({ type: "saveFinished" })
      if (current.id) {
        await loadRef.current(true)
        return
      }
      const created = saved.issue ? issueFromProto(saved.issue) : null
      if (!created?.id) return
      const filters = latest.current?.filters ?? { basePath: basePathOf(workspace) }
      const url = new URL(pageHref(filters, created.id), "http://yaru.local")
      deleteNewIssueParams(url)
      navigate.current(`${url.pathname}${url.search}`, "replace")
    } catch (error) {
      if (saveFailure(error) === "rejected") {
        dispatch({ type: "saveRejected", message: errorText(error) })
        return
      }
      dispatch({ type: "saveFailed", message: errorText(error) })
    }
  }, [workspace])

  const commitField = useCallback(
    async (field: DraftField, value: string) => {
      const currentState = latest.current
      const saved = currentState?.saved
      if (!currentState?.current?.id || !saved || saved.id !== currentState.current.id) {
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
        await clientsRef.current.issues.saveIssue(
          saveIssueInit(workspace, { id: saved.id, ...change }),
        )
        automaticRetryUsed.current = false
        dispatch({ type: "saveFinished" })
        await loadRef.current(true)
      } catch (error) {
        if (saveFailure(error) === "rejected") {
          dispatch({ type: "fieldReverted", field })
          throw new SaveRejectedError(errorText(error))
        }
        dispatch({ type: "saveFailed", message: errorText(error) })
      } finally {
        pendingCommits.current.delete(commitKey)
      }
    },
    [workspace],
  )

  const patchIssue = useCallback(
    async (issueIdToPatch: string, input: Partial<SaveInput>) => {
      try {
        await clientsRef.current.issues.saveIssue(
          saveIssueInit(workspace, { ...input, id: issueIdToPatch }),
        )
        await loadRef.current(true)
      } catch (error) {
        if (saveFailure(error) === "rejected") throw new SaveRejectedError(errorText(error))
        dispatch({ type: "requestFailed", message: errorText(error) })
      }
    },
    [workspace],
  )

  const retrySave = useCallback(async () => {
    const currentState = latest.current
    const current = currentState?.current
    const saved = currentState?.saved
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
      await clientsRef.current.issues.saveIssue(
        saveIssueInit(workspace, { id: current.id, ...changes }),
      )
      automaticRetryUsed.current = false
      dispatch({ type: "saveFinished" })
      await loadRef.current(true)
    } catch (error) {
      if (saveFailure(error) === "rejected") {
        dispatch({ type: "saveRejected", message: errorText(error) })
        return
      }
      dispatch({ type: "saveFailed", message: errorText(error) })
    }
  }, [saveCurrent, workspace])

  useEffect(() => {
    if (!loadedSinceFailure.current) return
    loadedSinceFailure.current = false
    if (state?.saveState !== "failed" || !state.draftDirty || !state.current?.id) return
    if (automaticRetryUsed.current) return
    automaticRetryUsed.current = true
    void retrySave()
  }, [state, retrySave])

  const postComment = useCallback(
    async (body: string): Promise<Comment> => {
      const response = await clientsRef.current.comments.saveComment({
        workspace,
        issue: issueId,
        body,
      })
      if (!response.comment) throw new Error("comment response is missing a comment")
      return commentFromProto(response.comment)
    },
    [issueId, workspace],
  )

  return {
    state,
    loadError,
    now: state ? serverNowOrNull(state.now) : null,
    reload,
    changeDraft,
    commitField,
    saveCurrent,
    retrySave,
    patchIssue,
    postComment,
  }
}

function serverNowOrNull(value: string): Date | null {
  try {
    return serverNow(value)
  } catch {
    return null
  }
}

function basePathOf(workspace: string): string {
  return `/p/${encodeURIComponent(workspace)}`
}

function withoutReturned(query: BoardQuery): BoardQuery {
  return { ...query, error: null, comment: null, questionId: null, answer: null }
}

export function addressOf(workspace: string, issueId: string, query: BoardQuery): string {
  const filters = {
    basePath: basePathOf(workspace),
    query: query.query ?? undefined,
    status: query.status ?? undefined,
    assignee: query.assignee ?? undefined,
    label: query.label ?? undefined,
    awaiting: query.awaiting === "1",
    sort: query.sort ?? undefined,
    group: query.group ?? undefined,
    completed: query.completed ?? undefined,
    view: query.view ?? undefined,
  }
  const href = pageHref(filters, issueId)
  const url = new URL(href, "http://yaru.local")
  if (query.newStatus) url.searchParams.set("new_status", query.newStatus)
  if (query.newParent) url.searchParams.set("new_parent", query.newParent)
  if (query.newLabel) url.searchParams.set("new_label", query.newLabel)
  if (query.newAssignee) url.searchParams.set("new_assignee", query.newAssignee)
  if (query.error) url.searchParams.set("error", query.error)
  if (query.comment !== null) url.searchParams.set("comment", query.comment)
  if (query.questionId) url.searchParams.set("q", query.questionId)
  if (query.answer !== null) url.searchParams.set("answer", query.answer)
  const search = url.searchParams.toString()
  return `${url.pathname}${search ? `?${search}` : ""}`
}
