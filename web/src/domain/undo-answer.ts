import type { Question } from "./question"

// 答えてから取り消せるまでの時間。src/questions.ts:252
export const UNDO_ANSWER_MILLISECONDS = 30_000

// 取り消せない答えの知らせを出しておく時間。src/ui/answered-toast.tsx
export const ANSWERED_NOTICE_MILLISECONDS = 5_000

// 取り消しの時間が終わる時刻。取り消せない答えなら null。src/questions.ts:318-323
export function undoAnswerDeadline(question: Question): Date | null {
  if (question.status !== "answered" || question.answeredAt === null) return null
  if (question.acknowledgedAt !== null) return null
  if (isLateAnswer(question.issue, question.answerBy, question.answeredAt)) return null
  return new Date(Date.parse(question.answeredAt) + UNDO_ANSWER_MILLISECONDS)
}

export function answeredNoticeExpiresAt(question: Question): Date | null {
  if (question.status !== "answered" || question.answeredAt === null) return null
  return (
    undoAnswerDeadline(question) ??
    new Date(Date.parse(question.answeredAt) + ANSWERED_NOTICE_MILLISECONDS)
  )
}

function isLateAnswer(issue: string | null, answerBy: string | null, answeredAt: string): boolean {
  if (issue === null || answerBy === null) return false
  return Date.parse(answerBy) <= Date.parse(answeredAt)
}
