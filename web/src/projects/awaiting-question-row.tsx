import { FOCUS_RING } from "../components/focus-ring"
import { RelativeTime } from "../components/relative-time"
import type { Question } from "../domain/question"

// プロジェクトのカードに並べる、答え待ちの質問の 1 行。src/projects/awaiting-question-row.tsx

export function AwaitingQuestionRow({
  question,
  href,
  now,
}: {
  question: Question
  href: string
  now: Date
}) {
  return (
    <li>
      <a
        href={href}
        class={`-mx-1.5 flex min-h-9 items-baseline gap-2 rounded-md px-1.5 py-1.5 no-underline transition-colors hover:bg-surface-2 ${FOCUS_RING}`}
      >
        <span class="text-micro w-20 shrink-0">
          <Urgency question={question} now={now} />
        </span>
        <span class="text-micro w-8 shrink-0 font-mono text-ink-tertiary">Q{question.id}</span>
        <span class="text-body min-w-0 flex-1 truncate text-ink-muted">{question.title}</span>
      </a>
    </li>
  )
}

function Urgency({ question, now }: { question: Question; now: Date }) {
  if (question.status === "expired") return <span class="text-ink-tertiary">Proceeded</span>
  if (question.defaultAction === null) return <span class="text-primary-hover">Blocking</span>
  if (question.answerBy === null) return <span class="text-ink-tertiary">No deadline</span>
  return <RelativeTime at={question.answerBy} now={now} class="text-ink-subtle" />
}
