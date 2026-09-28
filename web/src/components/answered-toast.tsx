import { useEffect } from "preact/hooks"
import type { Question } from "../domain/question"
import { answeredNoticeExpiresAt, undoAnswerDeadline } from "../domain/undo-answer"
import { AnswerUndoToast } from "./answer-undo-toast"

// 答えた直後の画面の状態だけで出す知らせ。開き直した URL の ?answered= からは戻さない
// docs/spec/routes.md の「決定」3。時間の計算は src/ui/answered-toast.tsx

export function AnsweredToast({
  question,
  basePath,
  returnTo,
  now,
  onExpire,
}: {
  question: Question
  basePath: string
  returnTo: string
  now: Date
  onExpire?: () => void
}) {
  const undoUntil = undoAnswerDeadline(question)
  const expiresAt = answeredNoticeExpiresAt(question)
  const expiresAtMs = expiresAt?.getTime() ?? null
  const nowMs = now.getTime()
  useEffect(() => {
    if (expiresAtMs === null) return
    const remaining = Math.max(0, expiresAtMs - nowMs)
    const removeTimer = setTimeout(() => onExpire?.(), remaining)
    const announceTimer = setTimeout(() => {
      const announce = document.querySelector<HTMLElement>("#answer-toast [data-announce]")
      if (announce) announce.textContent = announce.dataset.announce ?? ""
    }, 100)
    return () => {
      clearTimeout(removeTimer)
      clearTimeout(announceTimer)
    }
  }, [expiresAtMs, nowMs, onExpire])
  if (expiresAt === null || expiresAt.getTime() <= now.getTime()) return null
  return (
    <AnswerUndoToast
      question={question}
      basePath={basePath}
      returnTo={returnTo}
      undoUntil={undoUntil?.toISOString() ?? null}
      expiresAt={expiresAt.toISOString()}
    />
  )
}
