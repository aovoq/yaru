import { Code, ConnectError } from "@connectrpc/connect"
import { QuestionConflictSchema } from "../gen/yaru/v1/common_pb"
import type { QuestionLike } from "../domain/from-proto"

export function isRequestCanceled(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.Canceled
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.NotFound
}

export function connectErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConnectError && error.rawMessage !== "") return error.rawMessage
  if (error instanceof Error && error.message !== "") return `${fallback}: ${error.message}`
  return fallback
}

export function conflictQuestion(error: unknown): QuestionLike | undefined {
  if (!(error instanceof ConnectError)) return undefined
  const details = error.findDetails(QuestionConflictSchema)
  return details[0]?.question
}
