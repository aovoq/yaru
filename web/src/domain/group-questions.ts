import type { AwaitingQuestionGroups, Question } from "./question"

// 人が先に見るべき順。src/questions.ts:402-458 と同じ
// 1. 止まっている質問。長く待たせているものから
// 2. 期限までに答えないと既定の行動で進む質問。期限の近いものから
// 3. 期限の無い質問。新しいものから
// 4. 期限が過ぎて既定の行動で進んだ質問。期限が最近過ぎたものから
// 5. 答え済みと取り下げた質問。最近片付いたものから

export function compareQuestions(left: Question, right: Question): number {
  const rank = questionRank(left) - questionRank(right)
  if (rank !== 0) return rank
  switch (questionRank(left)) {
    case 0:
      return (
        compareAnswerBy(left, right) ||
        left.createdAt.localeCompare(right.createdAt) ||
        compareIdAscending(left, right)
      )
    case 1:
      return compareAnswerBy(left, right) || compareIdAscending(left, right)
    case 2:
      return right.createdAt.localeCompare(left.createdAt) || compareIdAscending(right, left)
    case 3:
      return (
        (right.answerBy ?? "").localeCompare(left.answerBy ?? "") || compareIdAscending(right, left)
      )
    default:
      return resolvedAt(right).localeCompare(resolvedAt(left)) || compareIdAscending(right, left)
  }
}

export function groupAwaitingQuestions(questions: Question[]): AwaitingQuestionGroups<Question>
export function groupAwaitingQuestions<T>(
  items: T[],
  questionOf: (item: T) => Question,
): AwaitingQuestionGroups<T>
export function groupAwaitingQuestions<T>(
  items: T[],
  questionOf: (item: T) => Question = (item) => item as Question,
): AwaitingQuestionGroups<T> {
  const groups: AwaitingQuestionGroups<T> = {
    blocking: [],
    dueSoon: [],
    noDeadline: [],
    proceeded: [],
  }
  const keys = ["blocking", "dueSoon", "noDeadline", "proceeded"] as const
  const sorted = [...items].sort((left, right) =>
    compareQuestions(questionOf(left), questionOf(right)),
  )
  for (const item of sorted) {
    const key = keys[questionRank(questionOf(item))]
    if (key) groups[key].push(item)
  }
  return groups
}

function questionRank(question: Question): number {
  if (question.status === "open") {
    if (question.defaultAction === null) return 0
    return question.answerBy !== null ? 1 : 2
  }
  if (question.status === "expired") return 3
  return 4
}

function compareAnswerBy(left: Question, right: Question): number {
  if (left.answerBy === right.answerBy) return 0
  if (left.answerBy === null) return 1
  if (right.answerBy === null) return -1
  return left.answerBy.localeCompare(right.answerBy)
}

function compareIdAscending(left: Question, right: Question): number {
  return Number(left.id) - Number(right.id)
}

function resolvedAt(question: Question): string {
  return question.answeredAt ?? question.canceledAt ?? question.createdAt
}
