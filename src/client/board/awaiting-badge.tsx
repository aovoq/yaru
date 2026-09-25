import type { AwaitingSummary } from "../../page"
import { Pill } from "../../components/pill"
import { relativeTime } from "../../time"

// 人の答えを待っている質問がある issue の行とカードに付ける札。「?」と、最も早い期限までの残り時間を見せる
// 期限を過ぎてエージェントが既定の動きで進んだ質問があれば、答えても間に合わないかもしれないことを危険の色で示す
// 見た目は短く削るので、読み上げと hover には件数と期限を文で渡す
// https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html

export function AwaitingBadge({ summary, now }: { summary: AwaitingSummary; now: Date }) {
  // 期限を過ぎてからサーバーが expired にするまでの間 (読み込んだまま開いている板) も、過ぎたものとして示す
  const passed =
    summary.soonestAnswerBy !== null && Date.parse(summary.soonestAnswerBy) <= now.getTime()
  const timeLeft =
    summary.soonestAnswerBy === null || passed
      ? null
      : relativeTime(summary.soonestAnswerBy, now).replace(/^in /, "")
  const description = describe(summary, timeLeft)
  return (
    <Pill
      tone={summary.expired > 0 || passed ? "danger" : "primary"}
      data-awaiting=""
      title={description}
      class="shrink-0 px-1.5 tabular-nums"
    >
      <span aria-hidden="true" class="font-medium">
        ?
      </span>
      {summary.count > 1 ? <span aria-hidden="true">{summary.count}</span> : null}
      {timeLeft !== null ? <span aria-hidden="true">{timeLeft}</span> : null}
      <span class="sr-only">{description}</span>
    </Pill>
  )
}

function describe(summary: AwaitingSummary, timeLeft: string | null): string {
  const questions = `${summary.count} ${summary.count === 1 ? "question" : "questions"} awaiting answer`
  const parts = [questions]
  if (timeLeft !== null) parts.push(`next due in ${timeLeft}`)
  if (summary.expired > 0) parts.push(`${summary.expired} past the deadline`)
  return parts.join(", ")
}
