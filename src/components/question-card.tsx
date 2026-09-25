import type { Question } from "../questions"
import { Button } from "./button"
import { Markdown } from "./markdown"
import { PriorityBadge } from "./priority-badge"
import { answerFormId, isAwaitingAnswer } from "./question-answer"
import { QuestionTiming } from "./question-timing"

// エージェントの質問を 1 枚のカードで見せ、答え待ちならその場で答えられるようにする。dashboard と issue 画面の両方で使う
// 回答のフォームはカードの外に QuestionAnswerForm (question-answer-form.tsx) で置き、入力欄とボタンを form 属性で結びつける
// issue 画面ではカードが issue を保存するフォームの中にあり、フォームは入れ子にできないため
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form

export function QuestionCard({
  question,
  now,
  issueLink,
}: {
  question: Question
  now: Date
  // 質問が紐づく issue へのリンク。issue 画面の中では同じ issue なので渡さない
  issueLink?: { href: string; title: string }
}) {
  const expired = question.status === "expired"
  const formId = answerFormId(question)
  return (
    <article
      data-question-status={question.status}
      class={`flex flex-col gap-2.5 rounded-lg border bg-surface-1 p-3 ${
        expired ? "border-semantic-danger/40" : "border-hairline"
      }`}
    >
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span class="font-mono text-ink-tertiary">Q{question.id}</span>
        {question.priority ? <PriorityBadge priority={question.priority} /> : null}
        <QuestionTiming question={question} now={now} />
        {issueLink ? (
          <a
            href={issueLink.href}
            class="min-w-0 truncate text-ink-subtle no-underline hover:text-ink"
          >
            #{question.issue} {issueLink.title}
          </a>
        ) : null}
      </div>
      <h3 class="text-[15px] leading-snug font-medium text-ink">{question.title}</h3>
      {question.body ? <Markdown source={question.body} compact /> : null}
      {question.defaultAction ? (
        <p class="rounded-md border border-hairline bg-surface-2 px-2.5 py-2 text-[13px] text-ink-muted">
          <span class="mr-1.5 text-[11px] text-ink-tertiary">
            {expired ? "Proceeding with default" : "Default"}
          </span>
          {question.defaultAction}
        </p>
      ) : null}
      {question.answer !== null ? (
        <Markdown source={question.answer} compact class="border-l-2 border-primary pl-2.5" />
      ) : null}
      {isAwaitingAnswer(question) ? (
        <div class="flex flex-col gap-2">
          <textarea
            form={formId}
            name="body"
            rows={3}
            placeholder="Answer"
            class="w-full resize-y rounded-md border border-hairline bg-canvas px-2.5 py-2 font-sans text-[15px] text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none sm:text-[13px]"
          />
          <div class="flex gap-2">
            <Button
              type="submit"
              form={formId}
              variant="primary"
              size="md"
              class="flex-1 sm:flex-none"
            >
              Answer
            </Button>
            {question.defaultAction ? (
              <Button
                type="submit"
                form={formId}
                name="useDefault"
                value="1"
                formNoValidate
                size="md"
                class="flex-1 sm:flex-none"
              >
                Use default
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}
