import { useEffect, useRef, useState } from "preact/hooks"
import type { BoardQuery } from "../route"
import { Alert } from "../components/alert"
import { AnswerUndoToast } from "../components/answer-undo-toast"
import { ConfirmDialog } from "../components/confirm-dialog"
import type { Question } from "../domain/question"
import { hasUnsavedChanges } from "./draft-state"
import { deleteNewIssueParams, pageHref } from "./filters"
import { IssueView } from "./issue-view"
import { handleIssueKey } from "./issue-keyboard"
import { questionFromProto, questionStatusToProto } from "../domain/from-proto"
import { serverNow } from "./proto"
import { errorText } from "./save-error"
import { useIssueController, type IssueClients } from "./use-issue-controller"

// 板が issue を開く口。query.id が有るときだけ置く
// 閉じる・別の issue へ移る・作ったあとの URL は onNavigate で板に返す
// 板が自分から離れるときは、onBindLeave でもらった requestLeave を先に呼ぶ

const UNDO_ANSWER_MILLISECONDS = 30_000

export type { IssueClients }

export function IssueScreen({
  workspace,
  issueId,
  query,
  clients,
  onNavigate,
  onUnavailable,
  onBindLeave,
  onOpenMenu,
  watch,
}: {
  workspace: string
  issueId: string
  query: BoardQuery
  clients: IssueClients
  onNavigate: (href: string, mode?: "push" | "replace") => void
  onUnavailable?: (message: string) => void
  onBindLeave?: (requestLeave: (proceed: () => void) => void) => void
  onOpenMenu?: (issueId: string, anchor: HTMLElement) => void
  watch?: (refetch: () => void) => () => void
}) {
  const controller = useIssueController({
    workspace,
    issueId,
    query,
    clients,
    onNavigate,
    onUnavailable,
    watch,
  })
  const { state } = controller
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const [questionError, setQuestionError] = useState<{
    questionId: string
    message: string
  } | null>(null)
  const [toast, setToast] = useState<{ question: Question; now: Date } | null>(null)
  const leave = useRef<(proceed: () => void) => void>(() => {})

  leave.current = (proceed) => {
    if (state && hasUnsavedChanges(state)) {
      setPendingLeave(() => proceed)
      return
    }
    proceed()
  }

  useEffect(() => {
    onBindLeave?.((proceed) => leave.current(proceed))
  }, [onBindLeave, state])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!document.getElementById("issue-view")) return
      handleIssueKey(event, () => leave.current(() => closeIssue()))
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [state, workspace])

  useEffect(() => {
    const onSubmit = (event: Event) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement)) return
      const action = form.getAttribute("action") ?? ""
      const match = /\/questions\/([^/]+)\/(answer|cancel|undo)$/.exec(action)
      if (!match) return
      event.preventDefault()
      const id = decodeURIComponent(match[1] ?? "")
      const kind = match[2]
      const submitter = "submitter" in event ? (event.submitter as Element | null) : null
      if (kind === "cancel") void cancelQuestion(id)
      else if (kind === "undo") void undoQuestion(id, form)
      else void answerQuestion(id, form, submitter)
    }
    document.addEventListener("submit", onSubmit, true)
    return () => document.removeEventListener("submit", onSubmit, true)
  }, [state, workspace])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), UNDO_ANSWER_MILLISECONDS)
    return () => clearTimeout(timer)
  }, [toast])

  const closeIssue = () => {
    const filters = state?.filters ?? { basePath: `/p/${encodeURIComponent(workspace)}` }
    const url = new URL(pageHref(filters), "http://yaru.local")
    url.searchParams.delete("id")
    deleteNewIssueParams(url)
    const search = url.searchParams.toString()
    onNavigate(`${url.pathname}${search ? `?${search}` : ""}`, "push")
  }

  const answerQuestion = async (id: string, form: HTMLFormElement, submitter: Element | null) => {
    const question = state?.questions.find((item) => item.id === id)
    const body = answerBody(form, submitter, question)
    const expected = form.querySelector<HTMLInputElement>('input[name="expectedStatus"]')?.value
    try {
      const response = await clients.questions.answerQuestion({
        workspace,
        id,
        body,
        expectedStatus: expected ? questionStatusToProto(expected) : undefined,
      })
      setQuestionError(null)
      const answered = response.question ? questionFromProto(response.question) : undefined
      if (answered) setToast({ question: answered, now: serverNow(response.now) })
      await controller.reload()
    } catch (error) {
      setQuestionError({ questionId: id, message: errorText(error) })
    }
  }

  const cancelQuestion = async (id: string) => {
    try {
      await clients.questions.cancelQuestion({ workspace, id })
      setQuestionError(null)
      await controller.reload()
    } catch (error) {
      setQuestionError({ questionId: id, message: errorText(error) })
    }
  }

  const undoQuestion = async (id: string, form: HTMLFormElement) => {
    const answeredAt = form.querySelector<HTMLInputElement>('input[name="answeredAt"]')?.value
    try {
      await clients.questions.undoAnswer({
        workspace,
        id,
        answeredAt: answeredAt || undefined,
      })
      setToast(null)
      await controller.reload()
    } catch (error) {
      setQuestionError({ questionId: id, message: errorText(error) })
    }
  }

  if (!state?.current || !controller.now) {
    if (!controller.loadError) return null
    return (
      <aside
        id="issue-view"
        role="dialog"
        aria-label="Issue"
        class="issue-view fixed inset-y-0 right-0 left-0 z-20 flex flex-col bg-canvas p-6"
      >
        <Alert onRetry={() => void controller.reload()}>{controller.loadError}</Alert>
      </aside>
    )
  }

  const now = controller.now
  const undoDeadline = toast ? undoUntil(toast.question, toast.now) : null

  return (
    <>
      <IssueView
        issue={state.current}
        all={state.all}
        filters={state.filters}
        error={state.requestError ?? state.error ?? controller.loadError ?? undefined}
        comments={state.comments}
        questions={state.questions}
        events={state.events}
        commits={state.commits}
        viewer={state.viewer || undefined}
        now={now}
        draftDirty={state.draftDirty}
        saveState={state.saveState}
        returnedDrafts={state.returnedDrafts}
        questionError={questionError ?? undefined}
        onChange={controller.changeDraft}
        onCommit={controller.commitField}
        onSave={controller.saveCurrent}
        onRetry={() => void controller.retrySave()}
        onPatchIssue={controller.patchIssue}
        onNavigate={(href) => leave.current(() => onNavigate(href, "push"))}
        onOpenMenu={
          onOpenMenu && state.current.id
            ? (anchor) => onOpenMenu(state.current?.id ?? "", anchor)
            : undefined
        }
        postComment={controller.postComment}
      />
      {pendingLeave ? (
        <ConfirmDialog
          title="Discard changes?"
          description={
            state.current.id
              ? "Some changes to this issue have not been saved."
              : "This new issue has not been created yet."
          }
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={() => {
            const proceed = pendingLeave
            setPendingLeave(null)
            proceed()
          }}
          onCancel={() => setPendingLeave(null)}
        />
      ) : null}
      {toast ? (
        <AnswerUndoToast
          question={toast.question}
          basePath={state.filters.basePath ?? ""}
          returnTo={pageHref(state.filters, state.current.id)}
          undoUntil={undoDeadline}
          expiresAt={
            undoDeadline ?? new Date(toast.now.getTime() + UNDO_ANSWER_MILLISECONDS).toISOString()
          }
        />
      ) : null}
    </>
  )
}

function answerBody(
  form: HTMLFormElement,
  submitter: Element | null,
  question: Question | undefined,
): string {
  if (submitter instanceof HTMLButtonElement && submitter.name === "useDefault") {
    return question?.defaultAction ?? ""
  }
  if (submitter instanceof HTMLButtonElement && submitter.name === "body") return submitter.value
  const field = document.querySelector<HTMLTextAreaElement>(
    `textarea[form="${form.id}"][name="body"]`,
  )
  return field?.value ?? ""
}

function undoUntil(question: Question, now: Date): string | null {
  if (question.status !== "answered" || question.answeredAt === null) return null
  if (question.acknowledgedAt !== null) return null
  if (
    question.issue !== null &&
    question.answerBy !== null &&
    Date.parse(question.answerBy) <= Date.parse(question.answeredAt)
  ) {
    return null
  }
  const deadline = Date.parse(question.answeredAt) + UNDO_ANSWER_MILLISECONDS
  if (Number.isNaN(deadline) || deadline <= now.getTime()) return null
  return new Date(deadline).toISOString()
}
