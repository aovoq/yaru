import type { Question } from "../questions"
import { relativeTime } from "../time"
import { Alert } from "./alert"
import { Button } from "./button"
import { Card } from "./card"
import { Collapsible } from "./collapsible"
import { IssueId } from "./issue-id"
import { FOCUS_RING } from "./focus-ring"
import { HIT_AREA } from "./hit-area"
import { Kbd } from "./kbd"
import { Markdown } from "./markdown"
import { Pill } from "./pill"
import { PriorityBadge } from "./priority-badge"
import {
  answerFormId,
  cancelFormId,
  isAwaitingAnswer,
  optionFormId,
  questionAnchorId,
  submitAnswerOnModifierEnter,
} from "./question-answer"
import { QuestionTiming } from "./question-timing"
import { Textarea } from "./textarea"

// エージェントの質問を 1 枚のカードで見せ、答え待ちならその場で答えられるようにする。dashboard と issue 画面の両方で使う
// 回答のフォームはカードの外に QuestionAnswerForm (question-answer-form.tsx) で置き、入力欄とボタンを form 属性で結びつける
// issue 画面ではカードが issue を保存するフォームの中にあり、フォームは入れ子にできないため
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form
//
// 答え済みと取り下げ済みの質問は、もう手を動かす必要が無いので 1 行にたたみ、押すと開いて全文を読めるようにする
// 期限切れの質問は、エージェントが既定の動き (defaultAction) で先に進んでいる。答えても使われないかもしれないので、
// 取り下げ (Dismiss) を主な操作にし、答えるボタン (Answer anyway) は一段弱くして、その旨を添える
// カードには q-<id> の id を付け、通知や一覧から #q-8 で飛べるようにする
// 複数のワークスペースの質問を並べる /inbox では、scope (ワークスペースの名前) を id に挟み、workspace でどのワークスペースの質問かを示す
// 期限のある答え待ちのカードには data-answer-by を付け、開いたままの画面で期限を過ぎたことをスクリプト (ui/live-page.ts) が気づけるようにする
// 送った答えが断られて戻ってきたときは、書きかけの答え (draft) を回答欄に戻し、理由 (error) をカードの中に出す

export function QuestionCard({
  question,
  now,
  issueLink,
  scope,
  workspace,
  draft,
  error,
}: {
  question: Question
  now: Date
  // 質問が紐づく issue へのリンク。issue 画面の中では同じ issue なので渡さない
  issueLink?: { href: string; title: string }
  scope?: string
  // 質問を聞いたワークスペースと、その dashboard でこの質問を開くリンク
  workspace?: { name: string; href: string }
  draft?: string
  error?: string
}) {
  const anchorId = questionAnchorId(question, scope)
  if (!isAwaitingAnswer(question)) {
    return (
      <Card as="article" id={anchorId} data-question-status={question.status}>
        <Collapsible
          summary={<SettledSummary question={question} now={now} />}
          summaryClass="min-h-11 px-3 py-2 sm:min-h-10"
        >
          <div class="flex flex-col gap-2.5 px-3 pb-3">
            <QuestionMeta
              question={question}
              now={now}
              issueLink={issueLink}
              workspace={workspace}
              settled
            />
            {question.body ? <Markdown source={question.body} compact /> : null}
            {question.defaultAction ? (
              <DefaultAction label="Default" action={question.defaultAction} />
            ) : null}
            {question.answer !== null ? <AnswerBlock answer={question.answer} /> : null}
          </div>
        </Collapsible>
      </Card>
    )
  }

  const expired = question.status === "expired"
  const formId = answerFormId(question, scope)
  const titleId = `${anchorId}-title`
  // 既定が選択肢の 1 つなら、その選択肢を先頭に出して「Default」の札を付け、「Use default」のボタンは重ねて出さない
  const defaultIsOption =
    question.defaultAction !== null && question.options.includes(question.defaultAction)
  const options = defaultIsOption
    ? [
        question.defaultAction!,
        ...question.options.filter((option) => option !== question.defaultAction),
      ]
    : question.options
  // 要素の並びは open と expired で変えない。期限切れは読むたびに決まり、書いている途中で変わることがあるので、
  // 並びが変わると preact が回答欄を作り直して書きかけの答えが消えるため
  return (
    <Card
      as="article"
      id={anchorId}
      danger={expired}
      data-question-status={question.status}
      data-answer-by={!expired && question.answerBy !== null ? question.answerBy : undefined}
      class="flex flex-col gap-2.5 p-3"
    >
      <QuestionMeta question={question} now={now} issueLink={issueLink} workspace={workspace} />
      <h3 id={titleId} class="text-title font-medium text-ink">
        {question.title}
      </h3>
      {question.body ? <Markdown source={question.body} compact /> : null}
      {question.defaultAction && (expired || !defaultIsOption) ? (
        <DefaultAction
          label={expired ? "Proceeded with default" : "Default"}
          action={question.defaultAction}
        />
      ) : null}
      {options.length > 0 ? (
        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {options.map((option, index) => (
            <Button
              key={option}
              type="submit"
              form={optionFormId(question, scope)}
              name="body"
              value={option}
              formNoValidate
              size="md"
              align="start"
            >
              <span class="min-w-0 truncate">{option}</span>
              {defaultIsOption && index === 0 ? <Pill tone="primary">Default</Pill> : null}
            </Button>
          ))}
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <Textarea
        form={formId}
        name="body"
        rows={3}
        required
        value={draft}
        placeholder={options.length > 0 ? "Or write an answer" : "Answer"}
        aria-label={`Answer to Q${question.id}`}
        aria-describedby={titleId}
        aria-keyshortcuts="Meta+Enter Control+Enter"
        data-answer-shortcut=""
        onKeyDown={submitAnswerOnModifierEnter}
      />
      {expired ? (
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <p class="text-small text-ink-subtle sm:mr-auto">Agent may have moved on</p>
          <Button type="submit" form={formId} size="md">
            Answer anyway
          </Button>
          <Button
            type="submit"
            form={cancelFormId(question, scope)}
            formNoValidate
            variant="primary"
            size="md"
          >
            Dismiss
          </Button>
        </div>
      ) : (
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {question.defaultAction && !defaultIsOption ? (
            <Button
              type="submit"
              form={formId}
              name="useDefault"
              value="1"
              formNoValidate
              size="md"
            >
              Use default
            </Button>
          ) : null}
          <Button type="submit" form={formId} variant="primary" size="md">
            Answer
            <span aria-hidden="true" class="hidden items-center gap-0.5 sm:inline-flex">
              <Kbd variant="on-primary">⌘</Kbd>
              <Kbd variant="on-primary">⏎</Kbd>
            </span>
          </Button>
        </div>
      )}
    </Card>
  )
}

// 番号・優先度・期限・紐づく issue を並べた、カードの上の小さな行
// settled はたたんだ質問を開いた中に置くとき。番号と時刻はたたんだ行に出ているので重ねて出さない
function QuestionMeta({
  question,
  now,
  issueLink,
  workspace,
  settled = false,
}: {
  question: Question
  now: Date
  issueLink?: { href: string; title: string }
  workspace?: { name: string; href: string }
  settled?: boolean
}) {
  return (
    <div class="text-micro flex flex-wrap items-center gap-x-2 gap-y-1">
      {workspace ? (
        <a
          href={workspace.href}
          class={`rounded-xs font-medium text-ink-muted no-underline hover:text-ink ${HIT_AREA} ${FOCUS_RING}`}
        >
          {workspace.name}
        </a>
      ) : null}
      {settled ? null : <span class="font-mono text-ink-tertiary">Q{question.id}</span>}
      {question.priority ? <PriorityBadge priority={question.priority} /> : null}
      {settled ? null : <QuestionTiming question={question} now={now} />}
      {question.status === "answered" ? <PickUp question={question} now={now} /> : null}
      {issueLink && question.issue ? (
        <a
          href={issueLink.href}
          class="inline-flex min-w-0 items-center gap-1 text-ink-subtle no-underline hover:text-ink"
        >
          <IssueId id={question.issue} />
          <span class="min-w-0 truncate">{issueLink.title}</span>
        </a>
      ) : null}
    </div>
  )
}

// 答えをエージェントが受け取ったか。受け取っていなければ、答えがまだ作業に使われていないと分かる
function PickUp({ question, now }: { question: Question; now: Date }) {
  if (question.acknowledgedAt === null) return <span class="text-ink-tertiary">Not picked up</span>
  return (
    <time
      datetime={question.acknowledgedAt}
      title={question.acknowledgedAt}
      class="text-ink-subtle"
    >
      Picked up {relativeTime(question.acknowledgedAt, now)}
    </time>
  )
}

// エージェントが答えを待たずに進むときの既定の動き
function DefaultAction({ label, action }: { label: string; action: string }) {
  return (
    <p class="text-body rounded-md border border-hairline bg-surface-2 px-2.5 py-2 text-ink-muted">
      <span class="text-micro mr-1.5 text-ink-tertiary">{label}</span>
      {action}
    </p>
  )
}

// 答えた内容。既定の行動 (DefaultAction) と同じ箱に「Answer」の見出しを付ける。答えは Markdown なので見出しの下の段に描く
function AnswerBlock({ answer }: { answer: string }) {
  return (
    <div class="rounded-md border border-hairline bg-surface-2 px-2.5 py-2">
      <span class="text-micro text-ink-tertiary">Answer</span>
      <Markdown source={answer} compact />
    </div>
  )
}

// たたんだ質問の 1 行。番号・題名・答えの最初の行・時刻を並べる
// 答えは Markdown なので、最初の行も renderMarkdown を通して描く。生の文字で出すと ** などの記号がそのまま見えるため
function SettledSummary({ question, now }: { question: Question; now: Date }) {
  const firstLine = question.answer?.split("\n").find((line) => line.trim()) ?? null
  return (
    <span class="text-body flex min-w-0 flex-1 items-center gap-2">
      <span class="text-micro w-7 shrink-0 font-mono text-ink-tertiary">Q{question.id}</span>
      <span class="min-w-0 shrink truncate font-medium text-ink">{question.title}</span>
      {firstLine ? (
        <Markdown
          source={firstLine}
          compact
          class="hidden min-w-0 flex-1 truncate sm:block *:inline"
        />
      ) : (
        <span class="hidden flex-1 sm:block" />
      )}
      <span class="text-micro ml-auto shrink-0">
        <QuestionTiming question={question} now={now} />
      </span>
    </span>
  )
}
