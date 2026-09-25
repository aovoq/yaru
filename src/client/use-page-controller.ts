import { useCallback, useEffect, useReducer, useRef } from "preact/hooks"
import type { PageData } from "../page"
import type { Issue, SaveInput } from "../store"
import {
  createClientState,
  fieldChange,
  reduceClientState,
  type ClientState,
  type DraftField,
} from "./state"

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
}

export function usePageController(initialPage: PageData): PageController {
  const [state, dispatch] = useReducer(reduceClientState, initialPage, createClientState)
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
        if (!response.ok) throw new Error(await responseError(response))
        const page = (await response.json()) as PageData
        if (sequence !== requestSequence.current) return
        if (historyMode === "push") history.pushState(null, "", pageUrl)
        if (historyMode === "replace") history.replaceState(null, "", pageUrl)
        dispatch({ type: "pageLoaded", page, preserveDraft })
      } catch (error) {
        dispatch({ type: "requestFailed", message: errorMessage(error) })
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
    events.onmessage = () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void navigate(window.location.href, "none", true), 80)
    }
    return () => {
      clearTimeout(refreshTimer)
      events.close()
    }
  }, [basePath, navigate])

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
      const response = await fetch(`${basePath}/api/issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await responseError(response))
      const saved = (await response.json()) as Issue
      dispatch({ type: "saveFinished" })
      if (state.current.id) {
        await navigate(window.location.href, "none", true)
        return
      }
      const pageUrl = new URL(window.location.href)
      pageUrl.searchParams.delete("new_status")
      pageUrl.searchParams.delete("new_parent")
      pageUrl.searchParams.set("id", saved.id)
      await navigate(pageUrl.href, "replace")
    } catch (error) {
      dispatch({ type: "requestFailed", message: errorMessage(error) })
    }
  }, [basePath, navigate, state.current])

  // Linear のように、属性は変えたとき、文字の欄は離れたときにその項目だけを保存する
  // 保存済みの値と同じなら書き込まない。新しい issue は Create まで保存しない
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
        const response = await fetch(`${basePath}/api/issues`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: saved.id, ...change }),
        })
        if (!response.ok) throw new Error(await responseError(response))
        dispatch({ type: "saveFinished" })
        await navigate(window.location.href, "none", true)
      } catch (error) {
        dispatch({ type: "requestFailed", message: errorMessage(error) })
      } finally {
        pendingCommits.current.delete(commitKey)
      }
    },
    [basePath, navigate, state.current, state.saved],
  )

  // 板や右クリックから、開いていない issue の一部の項目だけを保存する
  const patchIssue = useCallback(
    async (issueId: string, input: Partial<SaveInput>) => {
      try {
        const response = await fetch(`${basePath}/api/issues`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...input, id: issueId }),
        })
        if (!response.ok) throw new Error(await responseError(response))
        await navigate(window.location.href, "none", true)
      } catch (error) {
        dispatch({ type: "requestFailed", message: errorMessage(error) })
      }
    },
    [basePath, navigate],
  )

  const moveIssue = useCallback(
    (issueId: string, status: string) => patchIssue(issueId, { status }),
    [patchIssue],
  )

  return {
    state,
    navigate,
    changeDraft,
    selectIssue,
    saveCurrent,
    commitField,
    moveIssue,
    patchIssue,
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

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === "string"
    ? body.error
    : `request failed: expected successful response, actual ${response.status}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
