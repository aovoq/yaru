import { connectErrorMessage, conflictQuestion, isRequestCanceled } from "./connect-error"
import { questionFromProto, questionStatusToProto, type QuestionLike } from "../domain/from-proto"
import type { Question } from "../domain/question"
import { QuestionStatus } from "../gen/yaru/v1/common_pb"
import {
  answerBody,
  typedAnswer,
  type QuestionAction,
  type QuestionActionKind,
} from "./question-submit"

export type QuestionRpc = {
  answerQuestion(request: {
    workspace: string
    id: string
    body?: string
    expectedStatus?: QuestionStatus
  }): Promise<{ question: QuestionLike; now: string }>
  undoAnswer(request: {
    workspace: string
    id: string
    answeredAt?: string
  }): Promise<{ question: QuestionLike; now: string }>
  cancelQuestion(request: {
    workspace: string
    id: string
  }): Promise<{ question: QuestionLike; now: string }>
}

export type ActionSuccess = {
  ok: true
  kind: QuestionActionKind
  question: Question
  now: string
  next: string | null
  restoredAnswer: string
}

export type ActionFailure = {
  ok: false
  kind: QuestionActionKind
  id: string
  workspace: string
  message: string
  draft: string
  question?: Question
}

export async function performQuestionAction(
  client: QuestionRpc,
  action: QuestionAction,
  current: Question | undefined,
): Promise<ActionSuccess | ActionFailure> {
  try {
    if (action.kind === "answer") {
      const response = await client.answerQuestion({
        workspace: action.workspace,
        id: action.id,
        body: answerBody(action, current?.defaultAction ?? null),
        expectedStatus: questionStatusToProto(action.expectedStatus),
      })
      return success(action, response, "")
    }
    if (action.kind === "undo") {
      const restored = current === undefined ? "" : typedAnswer(current)
      const response = await client.undoAnswer({
        workspace: action.workspace,
        id: action.id,
        answeredAt: action.answeredAt === "" ? undefined : action.answeredAt,
      })
      return success(action, response, restored)
    }
    const response = await client.cancelQuestion({ workspace: action.workspace, id: action.id })
    return success(action, response, "")
  } catch (error) {
    if (isRequestCanceled(error)) throw error
    const conflict = conflictQuestion(error)
    return {
      ok: false,
      kind: action.kind,
      id: action.id,
      workspace: action.workspace,
      message: connectErrorMessage(error, `failed to ${action.kind} question ${action.id}`),
      draft: action.kind === "answer" ? action.body : "",
      question: conflict === undefined ? undefined : questionFromProto(conflict),
    }
  }
}

export function anchorForQuestion(action: QuestionAction): string {
  if (action.returnTo === "/inbox" && action.workspace !== "") {
    return `q-${action.workspace}-${action.id}`
  }
  return `q-${action.id}`
}

function success(
  action: QuestionAction,
  response: { question: QuestionLike; now: string },
  restoredAnswer: string,
): ActionSuccess {
  return {
    ok: true,
    kind: action.kind,
    question: questionFromProto(response.question),
    now: response.now,
    next: action.kind === "undo" ? anchorForQuestion(action) : action.next,
    restoredAnswer,
  }
}
