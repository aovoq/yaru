import { useEffect, useState } from "preact/hooks"
import { AnswerUndoToast } from "../components/answer-undo-toast"
import { createYaruClients } from "../connect/client"
import { commentFromProto, questionFromProto, questionStatusToProto } from "../domain/from-proto"
import type { Issue } from "../domain/issue"
import type { Question } from "../domain/question"
import { answeredNoticeExpiresAt, undoAnswerDeadline } from "../domain/undo-answer"
import { IssueView } from "./issue-view"
import type { Comment } from "../domain/comment"
import type { IssueEvent } from "../domain/issue-event"
import type { RepositoryCommit } from "../domain/repository"
import type { DraftField, PageFilters, ReturnedDrafts, SaveInput, SaveState } from "./model"
import { errorText } from "./save-error"

// 板が開いている issue の中身。読み込みと保存は板の状態を使い、コメントと質問の送信だけ Connect に渡す
// 板のキーボードと破棄の確認を二重に動かさない

export function BoardIssuePanel({
  workspace,
  issue,
  all,
  filters,
  comments,
  questions,
  events,
  commits,
  viewer,
  now,
  draftDirty,
  saveState,
  returnedDrafts,
  error,
  onChange,
  onCommit,
  onSave,
  onRetry,
  onPatchIssue,
  onNavigate,
  onOpenMenu,
}: {
  workspace: string
  issue: Issue
  all: Issue[]
  filters: PageFilters
  comments: Comment[]
  questions: Question[]
  events: IssueEvent[]
  commits: RepositoryCommit[]
  viewer?: string
  now: Date
  draftDirty: boolean
  saveState: SaveState
  returnedDrafts: ReturnedDrafts
  error?: string
  onChange: (field: DraftField, value: string) => void
  onCommit: (field: DraftField, value: string) => Promise<void>
  onSave: () => Promise<void>
  onRetry: () => void
  onPatchIssue: (issueId: string, input: Partial<SaveInput>) => Promise<void>
  onNavigate: (href: string) => void
  onOpenMenu?: (issueId: string, anchor: HTMLElement) => void
}) {
  const [questionError, setQuestionError] = useState<{
    questionId: string
    message: string
  } | null>(null)
  const [toast, setToast] = useState<Question | null>(null)

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
      if (kind === "cancel") void cancel(id)
      else if (kind === "undo") void undo(id, form)
      else void answer(id, form, submitter)
    }
    document.addEventListener("submit", onSubmit, true)
    return () => document.removeEventListener("submit", onSubmit, true)
  }, [workspace, questions])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 30_000)
    return () => clearTimeout(timer)
  }, [toast])

  const clients = () => createYaruClients(window.location.origin)

  const answer = async (id: string, form: HTMLFormElement, submitter: Element | null) => {
    const current = questions.find((item) => item.id === id)
    const body = answerBody(form, submitter, current)
    const expected = form.querySelector<HTMLInputElement>('input[name="expectedStatus"]')?.value
    try {
      const response = await clients().questions.answerQuestion({
        workspace,
        id,
        body,
        expectedStatus: expected ? questionStatusToProto(expected) : undefined,
      })
      setQuestionError(null)
      if (response.question) setToast(questionFromProto(response.question))
    } catch (caught) {
      setQuestionError({ questionId: id, message: errorText(caught) })
    }
  }

  const cancel = async (id: string) => {
    try {
      await clients().questions.cancelQuestion({ workspace, id })
      setQuestionError(null)
    } catch (caught) {
      setQuestionError({ questionId: id, message: errorText(caught) })
    }
  }

  const undo = async (id: string, form: HTMLFormElement) => {
    const answeredAt = form.querySelector<HTMLInputElement>('input[name="answeredAt"]')?.value
    try {
      await clients().questions.undoAnswer({
        workspace,
        id,
        answeredAt: answeredAt || undefined,
      })
      setToast(null)
    } catch (caught) {
      setQuestionError({ questionId: id, message: errorText(caught) })
    }
  }

  const deadline = toast ? undoAnswerDeadline(toast) : null
  const expires = toast ? answeredNoticeExpiresAt(toast) : null

  return (
    <>
      <IssueView
        issue={issue}
        all={all}
        filters={filters}
        error={error}
        comments={comments}
        questions={questions}
        events={events}
        commits={commits}
        viewer={viewer}
        now={now}
        draftDirty={draftDirty}
        saveState={saveState}
        returnedDrafts={returnedDrafts}
        questionError={questionError ?? undefined}
        onChange={onChange}
        onCommit={onCommit}
        onSave={onSave}
        onRetry={onRetry}
        onPatchIssue={onPatchIssue}
        onNavigate={onNavigate}
        onOpenMenu={onOpenMenu && issue.id ? (anchor) => onOpenMenu(issue.id, anchor) : undefined}
        postComment={async (body) => {
          const response = await clients().comments.saveComment({
            workspace,
            issue: issue.id,
            body,
          })
          if (!response.comment) throw new Error("comment response is missing a comment")
          return commentFromProto(response.comment)
        }}
      />
      {toast && expires ? (
        <AnswerUndoToast
          question={toast}
          basePath={filters.basePath ?? ""}
          returnTo={`${filters.basePath ?? ""}/?id=${encodeURIComponent(issue.id)}`}
          undoUntil={deadline ? deadline.toISOString() : null}
          expiresAt={expires.toISOString()}
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
