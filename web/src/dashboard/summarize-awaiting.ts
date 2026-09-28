import type { Question } from "../domain/question"

// サイドバーの「Awaiting answer」が数える、issue ごとの答え待ち。src/page.ts:196-215

export type AwaitingSummary = {
  count: number
  expired: number
  soonestAnswerBy: string | null
}

export function summarizeAwaiting(questions: Question[]): Record<string, AwaitingSummary> {
  const summaries: Record<string, AwaitingSummary> = {}
  for (const question of questions) {
    if (question.issue === null) continue
    const summary = (summaries[question.issue] ??= { count: 0, expired: 0, soonestAnswerBy: null })
    summary.count += 1
    if (question.status === "expired") {
      summary.expired += 1
      continue
    }
    if (
      question.answerBy !== null &&
      (summary.soonestAnswerBy === null ||
        Date.parse(question.answerBy) < Date.parse(summary.soonestAnswerBy))
    ) {
      summary.soonestAnswerBy = question.answerBy
    }
  }
  return summaries
}
