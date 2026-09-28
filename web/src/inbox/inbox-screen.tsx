import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks"
import {
  answerFormIdOf,
  INBOX_DRAFT_KEY,
  readAnswerDrafts,
  writeAnswerDrafts,
} from "../components/answer-drafts"
import { connectErrorMessage, isRequestCanceled } from "../components/connect-error"
import { ErrorView } from "../components/error-view"
import {
  awaitingDeadlinePassed,
  describeAwaitingChange,
  isEditingAnswer,
  POLL_INTERVAL_MS,
  RELATIVE_TIME_INTERVAL_MS,
  renderedAwaitingAnchors,
  replaceHash,
  sameAnchors,
  stripReturnParameters,
} from "../components/live-refresh"
import type { PageRefresh } from "../components/page-header"
import {
  anchorForQuestion,
  performQuestionAction,
  type QuestionRpc,
} from "../components/perform-question-action"
import { readQuestionAction, submitterOf } from "../components/question-submit"
import { createYaruClients } from "../connect/client"
import { groupAwaitingQuestions } from "../domain/group-questions"
import { questionFromProto, type QuestionLike } from "../domain/from-proto"
import { pageTitle } from "../domain/page-title"
import type { Question } from "../domain/question"
import {
  browserMonotonic,
  dateFromIso,
  serverClock,
  type ServerClock,
} from "../domain/server-clock"
import { cardFragment, type InboxQuery } from "../route"
import {
  InboxView,
  inboxAnchors,
  type InboxData,
  type InboxItem,
  type InboxReturned,
} from "./inbox-view"

// /inbox。GetInbox を 30 秒ごとに取り、質問の RPC で答える。src/inbox-page.tsx、src/ui/live-page.ts

type InboxItemLike = {
  workspace: string
  basePath: string
  href: string
  anchor: string
  question?: QuestionLike | undefined
}

type InboxResponseLike = {
  groups?:
    | {
        blocking?: readonly InboxItemLike[] | undefined
        dueSoon?: readonly InboxItemLike[] | undefined
        noDeadline?: readonly InboxItemLike[] | undefined
        proceeded?: readonly InboxItemLike[] | undefined
      }
    | undefined
  workspaces?:
    | readonly { slug: string; basePath: string; awaiting?: number | undefined }[]
    | undefined
  now: string
}

export type InboxClient = {
  getInbox(
    request: Record<string, never>,
    options?: { signal?: AbortSignal },
  ): Promise<InboxResponseLike>
}

export function InboxScreen({
  query,
  fragment,
  client,
  questions: questionClient,
  monotonicNow = browserMonotonic,
  pollIntervalMs = POLL_INTERVAL_MS,
  tickIntervalMs = RELATIVE_TIME_INTERVAL_MS,
}: {
  query: InboxQuery
  fragment: string | null
  client?: InboxClient
  questions?: QuestionRpc
  monotonicNow?: () => number
  pollIntervalMs?: number
  tickIntervalMs?: number
}) {
  const owned = useMemo(() => createYaruClients(""), [])
  const inboxClient = client ?? (owned.inbox as unknown as InboxClient)
  const questionsClient = questionClient ?? (owned.questions as unknown as QuestionRpc)
  const [inbox, setInbox] = useState<InboxData | null>(null)
  const [now, setNow] = useState<Date | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [returned, setReturned] = useState<InboxReturned | undefined>(() =>
    returnedFromQuery(query),
  )
  const [answered, setAnswered] = useState<{ question: Question; basePath: string } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>(() => initialDrafts(query))
  const [revealAnchor, setRevealAnchor] = useState<string | null>(fragment)
  const [refreshHidden, setRefreshHidden] = useState(true)
  const [refreshLabel, setRefreshLabel] = useState("Updated — Show")
  const clockRef = useRef<ServerClock | null>(null)
  const inboxRef = useRef<InboxData | null>(null)
  const pullRef = useRef<(force: boolean) => Promise<void>>(async () => {})
  inboxRef.current = inbox

  const rememberNow = useCallback(
    (nowIso: string) => {
      clockRef.current = serverClock(nowIso, monotonicNow)
      setNow(dateFromIso(nowIso))
    },
    [monotonicNow],
  )

  const apply = useCallback(
    (response: InboxResponseLike) => {
      setInbox(inboxFromResponse(response))
      rememberNow(response.now)
      setFailure(null)
    },
    [rememberNow],
  )

  const pull = useCallback(
    async (force: boolean) => {
      try {
        const response = await inboxClient.getInbox({})
        const next = inboxFromResponse(response)
        const anchors = inboxAnchors(next)
        if (!force && sameAnchors(renderedAwaitingAnchors(document), anchors)) return
        if (!force && isEditingAnswer(document)) {
          setRefreshLabel(describeAwaitingChange(renderedAwaitingAnchors(document), anchors))
          setRefreshHidden(false)
          return
        }
        apply(response)
        setRefreshHidden(true)
      } catch (error) {
        if (isRequestCanceled(error)) return
      }
    },
    [apply, inboxClient],
  )
  pullRef.current = pull

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await inboxClient.getInbox({}, { signal: controller.signal })
        if (controller.signal.aborted) return
        apply(response)
      } catch (error) {
        if (controller.signal.aborted || isRequestCanceled(error)) return
        setFailure(connectErrorMessage(error, "failed to load inbox"))
      }
    })()
    return () => controller.abort()
  }, [apply, inboxClient])

  useEffect(() => {
    if (inbox === null) return
    const timer = setInterval(() => {
      void pullRef.current(false)
    }, pollIntervalMs)
    return () => clearInterval(timer)
  }, [inbox === null, pollIntervalMs])

  useEffect(() => {
    if (inbox === null) return
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
  }, [inbox === null, tickIntervalMs])

  useEffect(() => {
    writeAnswerDrafts(INBOX_DRAFT_KEY, drafts)
  }, [drafts])

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
      const action = readQuestionAction(form, submitterOf(event))
      if (action === null) return
      event.preventDefault()
      const formId = answerFormIdOf(form.id)
      setDrafts((current) => {
        const next = { ...current }
        delete next[formId]
        return next
      })
      const currentInbox = inboxRef.current
      const currentQuestion = currentInbox
        ? findQuestion(currentInbox, action.workspace, action.id)
        : undefined
      void performQuestionAction(questionsClient, action, currentQuestion).then((result) => {
        if (!result.ok) {
          setInbox((current) =>
            current === null || result.question === undefined
              ? current
              : withQuestion(current, result.workspace, result.question),
          )
          setReturned({
            workspace: result.workspace,
            question: result.id,
            error: result.message,
            answer: result.draft === "" ? undefined : result.draft,
          })
          if (result.draft !== "") setDrafts((current) => ({ ...current, [formId]: result.draft }))
          return
        }
        setInbox((current) =>
          current === null ? current : withQuestion(current, action.workspace, result.question),
        )
        rememberNow(result.now)
        if (result.kind === "answer" && result.question.status === "answered") {
          setAnswered({ question: result.question, basePath: workspaceBasePath(action.workspace) })
          setReturned(undefined)
        } else if (result.kind === "undo") {
          setAnswered(null)
          setReturned(
            result.restoredAnswer === ""
              ? undefined
              : {
                  workspace: action.workspace,
                  question: result.question.id,
                  answer: result.restoredAnswer,
                },
          )
          if (result.restoredAnswer !== "") {
            setDrafts((current) => ({ ...current, [formId]: result.restoredAnswer }))
          }
        } else {
          setAnswered(null)
          setReturned(undefined)
        }
        const nextFragment = result.next ?? anchorForQuestion(action)
        replaceHash(nextFragment)
        setRevealAnchor(nextFragment)
      })
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
    document.title = pageTitle("Inbox")
  }, [])

  const expireAnswered = useCallback(() => setAnswered(null), [])
  const showChanges = useCallback(() => {
    void pullRef.current(true)
  }, [])

  if (failure !== null && inbox === null) return <ErrorView message={failure} />
  if (inbox === null || now === null) return null
  const refresh: PageRefresh = { hidden: refreshHidden, label: refreshLabel, onShow: showChanges }
  return (
    <InboxView
      inbox={inbox}
      now={now}
      returned={returned}
      answered={answered}
      drafts={drafts}
      revealAnchor={revealAnchor ?? undefined}
      refresh={refresh}
      onAnsweredExpire={expireAnswered}
    />
  )
}

function returnedFromQuery(query: InboxQuery): InboxReturned | undefined {
  if (
    query.workspace === null &&
    query.questionId === null &&
    query.error === null &&
    query.answer === null
  ) {
    return undefined
  }
  return {
    workspace: query.workspace ?? undefined,
    question: query.questionId ?? undefined,
    error: query.error ?? undefined,
    answer: query.answer ?? undefined,
  }
}

function initialDrafts(query: InboxQuery): Record<string, string> {
  const drafts = readAnswerDrafts(INBOX_DRAFT_KEY)
  if (
    query.workspace !== null &&
    query.questionId !== null &&
    query.answer !== null &&
    query.answer !== ""
  ) {
    drafts[`answer-question-${query.workspace}-${query.questionId}`] = query.answer
  }
  return drafts
}

function inboxFromResponse(response: InboxResponseLike): InboxData {
  const groups = response.groups
  const items = [
    ...itemsFrom(groups?.blocking),
    ...itemsFrom(groups?.dueSoon),
    ...itemsFrom(groups?.noDeadline),
    ...itemsFrom(groups?.proceeded),
  ]
  return {
    groups: groupAwaitingQuestions(items, (item) => item.question),
    workspaces: (response.workspaces ?? []).map((workspace) => ({
      slug: workspace.slug,
      basePath: workspace.basePath,
      awaiting:
        workspace.awaiting ?? items.filter((item) => item.workspace === workspace.slug).length,
    })),
  }
}

function itemsFrom(items: readonly InboxItemLike[] | undefined): InboxItem[] {
  const mapped: InboxItem[] = []
  for (const item of items ?? []) {
    if (item.question === undefined) continue
    mapped.push({
      workspace: item.workspace,
      basePath: item.basePath,
      href: item.href,
      anchor: item.anchor,
      question: questionFromProto(item.question),
    })
  }
  return mapped
}

function findQuestion(inbox: InboxData, workspace: string, id: string): Question | undefined {
  return [
    ...inbox.groups.blocking,
    ...inbox.groups.dueSoon,
    ...inbox.groups.noDeadline,
    ...inbox.groups.proceeded,
  ].find((item) => item.workspace === workspace && item.question.id === id)?.question
}

function withQuestion(inbox: InboxData, workspace: string, question: Question): InboxData {
  const kept = [
    ...inbox.groups.blocking,
    ...inbox.groups.dueSoon,
    ...inbox.groups.noDeadline,
    ...inbox.groups.proceeded,
  ].filter((item) => !(item.workspace === workspace && item.question.id === question.id))
  if (question.status === "open" || question.status === "expired") {
    const basePath = workspaceBasePath(workspace)
    kept.push({
      workspace,
      basePath,
      href: `${basePath}/dashboard#q-${encodeURIComponent(question.id)}`,
      anchor: `q-${workspace}-${question.id}`,
      question,
    })
  }
  return {
    groups: groupAwaitingQuestions(kept, (item) => item.question),
    workspaces: inbox.workspaces.map((entry) => ({
      ...entry,
      awaiting:
        entry.slug === workspace
          ? kept.filter((item) => item.workspace === workspace).length
          : entry.awaiting,
    })),
  }
}

function workspaceBasePath(workspace: string): string {
  return `/p/${encodeURIComponent(workspace)}`
}
