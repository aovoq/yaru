import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks"
import type { Transport } from "@connectrpc/connect"
import {
  answerFormIdOf,
  dashboardDraftKey,
  readAnswerDrafts,
  writeAnswerDrafts,
} from "../components/answer-drafts"
import { connectErrorMessage, isNotFound, isRequestCanceled } from "../components/connect-error"
import { ErrorView } from "../components/error-view"
import {
  awaitingDeadlinePassed,
  describeAwaitingChange,
  isEditingAnswer,
  RELATIVE_TIME_INTERVAL_MS,
  renderedAwaitingAnchors,
  replaceHash,
  stripReturnParameters,
} from "../components/live-refresh"
import type { PageRefresh } from "../components/page-header"
import { performQuestionAction, type QuestionRpc } from "../components/perform-question-action"
import { isAwaitingAnswer } from "../components/question-answer"
import { readQuestionAction, submitterOf } from "../components/question-submit"
import { createYaruClients } from "../connect/client"
import { subscribeWorkspace } from "../connect/watch"
import {
  issueFromProto,
  questionFromProto,
  repositoryFromProto,
  sessionHealthFromProto,
  type IssueLike,
  type QuestionLike,
  type RepositoryLike,
  type SessionHealthLike,
} from "../domain/from-proto"
import { pageTitle } from "../domain/page-title"
import type { Issue } from "../domain/issue"
import type { Question } from "../domain/question"
import type { RepositoryState } from "../domain/repository"
import {
  browserMonotonic,
  dateFromIso,
  serverClock,
  type ServerClock,
} from "../domain/server-clock"
import type { SessionHealth } from "../domain/session"
import { cardFragment, type DashboardQuery } from "../route"
import { DashboardView, type DashboardReturned } from "./dashboard-view"

// /p/<slug>/dashboard。GetDashboard と WatchWorkspace と質問の RPC。src/dashboard.tsx、src/ui/live-page.ts

export type DashboardResponseLike = {
  questions?: readonly QuestionLike[] | undefined
  issues?: readonly IssueLike[] | undefined
  sessionHealth?: SessionHealthLike | undefined
  repository?: RepositoryLike | undefined
  now: string
}

export type DashboardClient = {
  getDashboard(
    request: { workspace: string },
    options?: { signal?: AbortSignal },
  ): Promise<DashboardResponseLike>
}

type WatchWorkspace = (options: {
  transport: Transport
  workspace: string
  refetch: () => void
  signal: AbortSignal
}) => Promise<void>

type DashboardModel = {
  questions: Question[]
  issues: Issue[]
  sessionHealth: SessionHealth
  repository: RepositoryState | null
}

export function DashboardScreen({
  slug,
  query,
  fragment,
  client,
  questions: questionClient,
  watch = subscribeWorkspace,
  transport,
  monotonicNow = browserMonotonic,
  tickIntervalMs = RELATIVE_TIME_INTERVAL_MS,
}: {
  slug: string
  query: DashboardQuery
  fragment: string | null
  client?: DashboardClient
  questions?: QuestionRpc
  watch?: WatchWorkspace | null
  transport?: Transport
  monotonicNow?: () => number
  tickIntervalMs?: number
}) {
  const owned = useMemo(() => createYaruClients(""), [])
  const dashboardClient = client ?? (owned.dashboard as unknown as DashboardClient)
  const questionsClient = questionClient ?? (owned.questions as unknown as QuestionRpc)
  const usedTransport = transport ?? owned.transport
  const basePath = `/p/${encodeURIComponent(slug)}`
  const [model, setModel] = useState<DashboardModel | null>(null)
  const [now, setNow] = useState<Date | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [returned, setReturned] = useState<DashboardReturned | undefined>(() =>
    returnedFromQuery(query),
  )
  const [answered, setAnswered] = useState<Question | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>(() => initialDrafts(basePath, query))
  const [revealAnchor, setRevealAnchor] = useState<string | null>(fragment)
  const [refreshHidden, setRefreshHidden] = useState(true)
  const [refreshLabel, setRefreshLabel] = useState("Updated — Show")
  const clockRef = useRef<ServerClock | null>(null)
  const questionsRef = useRef<Question[]>([])
  const pullRef = useRef<(force: boolean) => Promise<void>>(async () => {})
  questionsRef.current = model?.questions ?? []

  const rememberNow = useCallback(
    (nowIso: string) => {
      clockRef.current = serverClock(nowIso, monotonicNow)
      setNow(dateFromIso(nowIso))
    },
    [monotonicNow],
  )

  const apply = useCallback(
    (response: DashboardResponseLike) => {
      setModel({
        questions: (response.questions ?? []).map(questionFromProto),
        issues: (response.issues ?? []).map(issueFromProto),
        sessionHealth: sessionHealthFromProto(response.sessionHealth),
        repository: repositoryFromProto(response.repository),
      })
      rememberNow(response.now)
      setFailure(null)
    },
    [rememberNow],
  )

  const pull = useCallback(
    async (force: boolean) => {
      try {
        const response = await dashboardClient.getDashboard({ workspace: slug })
        const nextAnchors = (response.questions ?? [])
          .map(questionFromProto)
          .filter(isAwaitingAnswer)
          .map((question) => `q-${question.id}`)
        if (!force && isEditingAnswer(document)) {
          setRefreshLabel(describeAwaitingChange(renderedAwaitingAnchors(document), nextAnchors))
          setRefreshHidden(false)
          return
        }
        apply(response)
        setRefreshHidden(true)
      } catch (error) {
        if (isRequestCanceled(error)) return
        if (!force && isEditingAnswer(document)) {
          setRefreshLabel("Updated — Show")
          setRefreshHidden(false)
        }
      }
    },
    [apply, dashboardClient, slug],
  )
  pullRef.current = pull

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await dashboardClient.getDashboard(
          { workspace: slug },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        apply(response)
      } catch (error) {
        if (controller.signal.aborted || isRequestCanceled(error)) return
        setFailure(
          isNotFound(error)
            ? `workspace not found: ${slug}`
            : connectErrorMessage(error, `failed to load dashboard for ${slug}`),
        )
      }
    })()
    return () => controller.abort()
  }, [apply, dashboardClient, slug])

  useEffect(() => {
    if (watch === null || model === null) return
    const controller = new AbortController()
    void watch({
      transport: usedTransport,
      workspace: slug,
      refetch: () => {
        void pullRef.current(false)
      },
      signal: controller.signal,
    })
    return () => controller.abort()
  }, [model === null, slug, usedTransport, watch])

  useEffect(() => {
    if (model === null) return
    const timer = setInterval(() => {
      const clock = clockRef.current
      if (clock === null) return
      const next = clock.now()
      setNow(next)
      if (!awaitingDeadlinePassed(document, next)) return
      if (isEditingAnswer(document)) {
        setRefreshLabel("Deadline passed — Show")
        setRefreshHidden(false)
        return
      }
      void pullRef.current(true)
    }, tickIntervalMs)
    return () => clearInterval(timer)
  }, [model === null, tickIntervalMs])

  useEffect(() => {
    writeAnswerDrafts(dashboardDraftKey(basePath), drafts)
  }, [basePath, drafts])

  useEffect(() => {
    stripReturnParameters()
    const onInput = (event: Event) => {
      const target = event.target
      if (
        !(target instanceof HTMLTextAreaElement) ||
        !target.hasAttribute("data-answer-shortcut")
      ) {
        return
      }
      const formId = target.getAttribute("form")
      if (formId === null) return
      setDrafts((current) => ({ ...current, [formId]: target.value }))
    }
    const onSubmit = (event: Event) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement)) return
      const submitter = submitterOf(event)
      const action = readQuestionAction(form, submitter)
      if (action === null) return
      event.preventDefault()
      const formId = answerFormIdOf(form.id)
      setDrafts((current) => {
        const next = { ...current }
        delete next[formId]
        return next
      })
      const currentQuestion = questionsRef.current.find((question) => question.id === action.id)
      void performQuestionAction(questionsClient, action, currentQuestion).then(
        (result) => {
          if (!result.ok) {
            const conflict = result.question
            if (conflict !== undefined) {
              setModel((current) =>
                current === null
                  ? current
                  : { ...current, questions: mergeQuestion(current.questions, conflict) },
              )
            }
            setReturned({
              question: result.id,
              error: result.message,
              answer: result.draft === "" ? undefined : result.draft,
            })
            if (result.draft !== "") {
              setDrafts((current) => ({ ...current, [formId]: result.draft }))
            }
            return
          }
          setModel((current) =>
            current === null
              ? current
              : { ...current, questions: mergeQuestion(current.questions, result.question) },
          )
          rememberNow(result.now)
          if (result.kind === "answer" && result.question.status === "answered") {
            setAnswered(result.question)
            setReturned(undefined)
          } else if (result.kind === "undo") {
            setAnswered(null)
            setReturned(
              result.restoredAnswer === ""
                ? undefined
                : { question: result.question.id, answer: result.restoredAnswer },
            )
            if (result.restoredAnswer !== "") {
              setDrafts((current) => ({ ...current, [formId]: result.restoredAnswer }))
            }
          } else {
            setAnswered(null)
            setReturned(undefined)
          }
          const nextFragment = result.next ?? anchorOf(action.workspace, action.id, action.returnTo)
          replaceHash(nextFragment)
          setRevealAnchor(nextFragment)
        },
        () => {
          setReturned({
            question: action.id,
            error: `failed to ${action.kind} question ${action.id}`,
          })
        },
      )
    }
    const onHash = () => {
      const next = cardFragment(window.location.hash)
      if (next !== null) setRevealAnchor(next)
    }
    document.addEventListener("input", onInput)
    document.addEventListener("submit", onSubmit, true)
    window.addEventListener("hashchange", onHash)
    return () => {
      document.removeEventListener("input", onInput)
      document.removeEventListener("submit", onSubmit, true)
      window.removeEventListener("hashchange", onHash)
    }
  }, [questionsClient, rememberNow])

  useEffect(() => {
    document.title = pageTitle("Dashboard", slug)
  }, [slug])

  useEffect(() => {
    if (revealAnchor === null || model === null) return
    const target = document.getElementById(revealAnchor)
    if (target !== null && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start" })
    }
  }, [model, revealAnchor])

  const expireAnswered = useCallback(() => setAnswered(null), [])
  const showChanges = useCallback(() => {
    void pullRef.current(true)
  }, [])

  if (failure !== null && model === null) {
    return <ErrorView message={failure} />
  }
  if (model === null || now === null) return null
  const refresh: PageRefresh = { hidden: refreshHidden, label: refreshLabel, onShow: showChanges }
  return (
    <DashboardView
      questions={model.questions}
      issues={model.issues}
      now={now}
      sessionHealth={model.sessionHealth}
      repository={model.repository}
      basePath={basePath}
      workspaceName={slug}
      returned={returned}
      answered={answered}
      drafts={drafts}
      revealAnchor={revealAnchor ?? undefined}
      refresh={refresh}
      onAnsweredExpire={expireAnswered}
    />
  )
}

function returnedFromQuery(query: DashboardQuery): DashboardReturned | undefined {
  if (query.questionId === null && query.error === null && query.answer === null) return undefined
  return {
    question: query.questionId ?? undefined,
    error: query.error ?? undefined,
    answer: query.answer ?? undefined,
  }
}

function initialDrafts(basePath: string, query: DashboardQuery): Record<string, string> {
  const drafts = readAnswerDrafts(dashboardDraftKey(basePath))
  if (query.questionId !== null && query.answer !== null && query.answer !== "") {
    drafts[`answer-question-${query.questionId}`] = query.answer
  }
  return drafts
}

function mergeQuestion(questions: Question[], question: Question): Question[] {
  const index = questions.findIndex((item) => item.id === question.id)
  if (index < 0) return [...questions, question]
  const next = questions.slice()
  next[index] = question
  return next
}

function anchorOf(workspace: string, id: string, returnTo: string): string {
  if (returnTo === "/inbox" && workspace !== "") return `q-${workspace}-${id}`
  return `q-${id}`
}
