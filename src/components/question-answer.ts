import type { Question } from "../questions"

// 質問に画面から答えられるかどうかと、回答の入力欄とフォームを結ぶ id を決める
// questions.ts は node:fs を読み込むので、ブラウザでも動く質問のカードからはここを使う

export function isAwaitingAnswer(question: Question): boolean {
  return question.status === "open" || question.status === "expired"
}

export function answerFormId(question: Question): string {
  return `answer-question-${question.id}`
}
