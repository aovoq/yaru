import type { Question } from "../questions"
import { localDateTime } from "../time"
import { RelativeTime } from "./relative-time"

// 質問の期限や回答の時刻を、状態に合わせた言い方と色で 1 行に示す
export function QuestionTiming({ question, now }: { question: Question; now: Date }) {
  if (question.status === "answered") {
    return (
      <RelativeTime
        at={question.answeredAt ?? ""}
        now={now}
        prefix="Answered "
        class="text-ink-subtle"
      />
    )
  }
  if (question.status === "canceled") return <span class="text-ink-tertiary">Canceled</span>
  if (!question.answerBy) return <span class="text-ink-tertiary">No deadline</span>
  if (question.status === "expired") {
    return (
      <RelativeTime
        at={question.answerBy}
        now={now}
        prefix="Expired "
        class="text-semantic-danger"
      />
    )
  }
  return (
    <span class="text-ink-subtle">
      Answer by {localDateTime(question.answerBy)} (
      <RelativeTime at={question.answerBy} now={now} />)
    </span>
  )
}
