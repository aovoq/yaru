import type { Question } from "../questions"
import { localDateTime, relativeTime } from "../time"

// 質問の期限や回答の時刻を、状態に合わせた言い方と色で 1 行に示す
export function QuestionTiming({ question, now }: { question: Question; now: Date }) {
  if (question.status === "answered") {
    return (
      <span class="text-ink-subtle">
        Answered {question.answeredAt ? relativeTime(question.answeredAt, now) : ""}
      </span>
    )
  }
  if (question.status === "canceled") return <span class="text-ink-tertiary">Canceled</span>
  if (!question.answerBy) return <span class="text-ink-tertiary">No deadline</span>
  if (question.status === "expired") {
    return <span class="text-semantic-danger">Expired {relativeTime(question.answerBy, now)}</span>
  }
  return (
    <span class="text-ink-subtle">
      Answer by {localDateTime(question.answerBy)} ({relativeTime(question.answerBy, now)})
    </span>
  )
}
