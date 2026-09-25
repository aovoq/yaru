import type { Question } from "../questions"

// プロジェクトの一覧のカードに並べる、答え待ちの質問の 1 行。期限切れは状態の言葉を危険の色にして目を引く

export function AwaitingQuestionRow({ question }: { question: Question }) {
  const expired = question.status === "expired"
  return (
    <li class="flex items-baseline gap-2 text-[13px]">
      <span
        class={`shrink-0 text-[11px] ${expired ? "text-semantic-danger" : "text-ink-tertiary"}`}
      >
        {expired ? "expired" : "open"}
      </span>
      <span class="min-w-0 flex-1 text-ink-muted">{question.title}</span>
    </li>
  )
}
