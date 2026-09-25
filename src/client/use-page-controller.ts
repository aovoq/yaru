import { useCallback, useEffect, useReducer, useRef } from "hono/jsx"
import type { PageData } from "../page"
import type { Issue, SaveInput } from "../store"
import { createClientState, reduceClientState, type ClientState, type DraftField } from "./state"

type HistoryMode = "push" | "replace" | "none"

export type PageController = {
  state: ClientState
  navigate: (href: string, historyMode?: HistoryMode, preserveDraft?: boolean) => Promise<void>
  changeDraft: (field: DraftField, value: string) => void
  selectIssue: (issueId: string | null) => void
  saveCurrent: () => Promise<void>
  moveIssue: (issueId: string, status: string) => Promise<void>
}

export function usePageController(initialPage: PageData): PageController {
  // hono/jsx の useReducer は init が初期値と同じ型を返す前提のため、PageData から ClientState への変換を init に渡せない
  const [state, dispatch] = useReducer(reduceClientState, createClientState(initialPage))
  const requestSequence = useRef(0)
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

  const saveCurrent = useCallback(async () => {
    if (!state.current) return
    const input: SaveInput = issueInput(state.current)
    try {
      const response = await fetch(`${basePath}/api/issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await responseError(response))
      const pageUrl = new URL(window.location.href)
      pageUrl.searchParams.delete("id")
      pageUrl.searchParams.delete("new_status")
      await navigate(pageUrl.href)
    } catch (error) {
      dispatch({ type: "requestFailed", message: errorMessage(error) })
    }
  }, [basePath, navigate, state.current])

  const moveIssue = useCallback(
    async (issueId: string, status: string) => {
      try {
        const response = await fetch(`${basePath}/api/issues`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: issueId, status }),
        })
        if (!response.ok) throw new Error(await responseError(response))
        await navigate(window.location.href, "none", true)
      } catch (error) {
        dispatch({ type: "requestFailed", message: errorMessage(error) })
      }
    },
    [basePath, navigate],
  )

  return { state, navigate, changeDraft, selectIssue, saveCurrent, moveIssue }
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
