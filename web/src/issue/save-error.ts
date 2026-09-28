import { Code, ConnectError } from "@connectrpc/connect"
import { shouldRetryConnectError } from "../connect/client"

// サーバーが値を受け付けなかった失敗。届かなかった失敗 (通信が切れた・再送してよいコード) と分ける
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5
export class SaveRejectedError extends Error {}

const REJECTED = new Set<Code>([
  Code.InvalidArgument,
  Code.NotFound,
  Code.AlreadyExists,
  Code.PermissionDenied,
  Code.FailedPrecondition,
  Code.OutOfRange,
  Code.Unauthenticated,
  Code.Aborted,
])

export function saveFailure(error: unknown): "rejected" | "failed" {
  if (error instanceof SaveRejectedError) return "rejected"
  if (error instanceof ConnectError && REJECTED.has(error.code)) return "rejected"
  if (shouldRetryConnectError(error)) return "failed"
  if (error instanceof ConnectError) return "failed"
  return "failed"
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
