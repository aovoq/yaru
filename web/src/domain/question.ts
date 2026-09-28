import type { Priority } from "./issue"

// 画面の部品が読む質問の形。ファイルの読み書きは Go 側。型は src/questions.ts:27-57 と同じ

export const QUESTION_STATUSES = ["open", "expired", "answered", "canceled"] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export type Question = {
  id: string
  title: string
  status: QuestionStatus
  issue: string | null
  priority: Priority | null
  defaultAction: string | null
  answerBy: string | null
  options: string[]
  author: string
  session: string | null
  worktree: string | null
  branch: string | null
  answer: string | null
  answeredBy: string | null
  answeredAt: string | null
  acknowledgedAt: string | null
  notifiedExpiringAt: string | null
  canceledAt: string | null
  createdAt: string
  updatedAt: string
  body: string
}

// src/questions.ts:102-107
export type AwaitingQuestionGroups<T> = {
  blocking: T[]
  dueSoon: T[]
  noDeadline: T[]
  proceeded: T[]
}
