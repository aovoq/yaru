import type { AwaitingQuestionGroups, Question } from "../domain/question"
import { Collapsible } from "./collapsible"
import { EmptyState } from "./empty-state"
import { QuestionAnswerForm } from "./question-answer-form"
import { questionAnchorId } from "./question-answer"
import { QuestionCard } from "./question-card"
import { Section } from "./section"

// 答えを待っている質問を、人が先に答えるべき順のまとまり (questions.ts の groupAwaitingQuestions) に分けて並べる
// dashboard (1 つのワークスペース) と /inbox (全ワークスペース) の両方で使う。空のまとまりは見出しごと出さない
//
// - Blocking: 既定の行動が無く、答えるまでエージェントが止まっている
// - Due soon: 期限までに答えないと既定の行動で進む
// - No deadline: 既定の行動はあるが期限が無い
// - Proceeded with default — override?: 期限が過ぎ、エージェントは既定の行動で進んだ。急ぎではないので題名と既定だけの 1 行にたたみ、
//   開くと取り下げる (Dismiss) か、あえて答える (Answer anyway) ことができる
//
// 答えたあとは次のカードへ戻れるよう、各カードのフォームに次のカードの id (next) を持たせる。最後のカードなら 1 つ前へ戻す
// 送った答えが断られて戻ってきたとき (returned) は、そのカードに書きかけと理由を戻し、たたんだ行なら開いておく
// fragment で飛んだ先が閉じた details の中だと見えないので、スクリプトに頼らずサーバーで開いて描く

export type AwaitingQuestionEntry = {
  question: Question
  // 回答のフォームの送り先のワークスペースの URL の接頭辞
  basePath: string
  // 複数のワークスペースの質問を並べるときのワークスペースの名前 (question-answer.ts)
  scope?: string
  issueLink?: { href: string; title: string }
  workspace?: { name: string; href: string }
  returnTo?: string
}

export type ReturnedAnswer = {
  // 戻ってきた質問のカードの id (questionAnchorId)
  anchor: string
  error?: string
  answer?: string
}

// まとまりを一覧に出す順と、見出し・添え書き
const GROUPS = [
  { key: "blocking", title: "Blocking", note: "The agent is stopped until you answer" },
  { key: "dueSoon", title: "Due soon", note: "The default applies at the deadline" },
  { key: "noDeadline", title: "No deadline", note: "Has a default, no deadline" },
  {
    key: "proceeded",
    title: "Proceeded with default — override?",
    note: "The agent moved on with the default",
  },
] as const

// 件数の札 (StatTile) から飛べるよう、答え待ちの全体と、既定で進んだまとまりに id を付ける
export const QUESTIONS_SECTION_ID = "questions"
export const PROCEEDED_GROUP_ID = "proceeded"

export function AwaitingQuestionList({
  groups,
  now,
  returned,
  emptyText = "No questions awaiting an answer",
}: {
  groups: AwaitingQuestionGroups<AwaitingQuestionEntry>
  now: Date
  returned?: ReturnedAnswer
  emptyText?: string
}) {
  const ordered = GROUPS.flatMap((group) => groups[group.key])
  const anchors = ordered.map((entry) => anchorOf(entry))
  const proceededAnchors = new Set(groups.proceeded.map((entry) => anchorOf(entry)))
  // 急ぐ質問に答え終わって次が既定で進んだ質問なら、たたんだまとまりの見出しへ戻す
  // その質問のカードへ戻すと、たたんでおきたい急がない質問を開いてしまうため (live-page.ts は飛んだ先の details を開く)
  const nextAnchor = (anchor: string) => {
    const index = anchors.indexOf(anchor)
    const next = anchors[index + 1] ?? anchors[index - 1]
    if (next === undefined) return QUESTIONS_SECTION_ID
    if (proceededAnchors.has(next) && !proceededAnchors.has(anchor)) return PROCEEDED_GROUP_ID
    return next
  }
  return (
    <Section id={QUESTIONS_SECTION_ID} title="Questions" count={ordered.length}>
      <div data-awaiting-ids={anchors.join(" ")} hidden />
      {ordered.length === 0 ? <EmptyState>{emptyText}</EmptyState> : null}
      {GROUPS.map((group) => {
        const entries = groups[group.key]
        if (entries.length === 0) return null
        const proceeded = group.key === "proceeded"
        return (
          <div
            key={group.key}
            id={proceeded ? PROCEEDED_GROUP_ID : undefined}
            data-question-group={group.key}
            class="flex flex-col gap-2"
          >
            <h3 class="text-small flex flex-wrap items-baseline gap-x-2 text-ink-subtle">
              <span class="font-medium text-ink-muted">{group.title}</span>
              <span class="text-ink-tertiary tabular-nums">{entries.length}</span>
              <span class="text-micro text-ink-tertiary">{group.note}</span>
            </h3>
            {entries.map((entry) => {
              const anchor = anchorOf(entry)
              const card = (
                <AwaitingQuestion
                  key={anchor}
                  entry={entry}
                  now={now}
                  next={nextAnchor(anchor)}
                  returned={returned?.anchor === anchor ? returned : undefined}
                />
              )
              if (!proceeded) return card
              return (
                <div data-proceeded="" key={anchor}>
                  <Collapsible
                    open={returned?.anchor === anchor}
                    summary={<ProceededSummary question={entry.question} workspace={entry.scope} />}
                    summaryClass="min-h-11 rounded-lg border border-hairline bg-surface-1 px-3 py-2 sm:min-h-10"
                  >
                    {/* details を flex にすると、閉じていても中身の枠が gap を取って行の間が空くので、開いたときの間は中身に持たせる */}
                    <div class="mt-2">{card}</div>
                  </Collapsible>
                </div>
              )
            })}
          </div>
        )
      })}
    </Section>
  )
}

function anchorOf(entry: AwaitingQuestionEntry): string {
  return questionAnchorId(entry.question, entry.scope)
}

// 答え待ちの質問 1 つ分。カードと、カードの入力欄が送る先のフォームを並べる
function AwaitingQuestion({
  entry,
  now,
  next,
  returned,
}: {
  entry: AwaitingQuestionEntry
  now: Date
  next: string
  returned?: ReturnedAnswer
}) {
  return (
    <>
      <QuestionCard
        question={entry.question}
        now={now}
        issueLink={entry.issueLink}
        scope={entry.scope}
        workspace={entry.workspace}
        draft={returned?.answer}
        error={returned?.error}
      />
      <QuestionAnswerForm
        question={entry.question}
        basePath={entry.basePath}
        returnTo={entry.returnTo}
        next={next}
        scope={entry.scope}
      />
    </>
  )
}

// 既定で進んだ質問をたたんだ 1 行。番号・題名・進んだ既定の行動を並べる
// 既定の行動の無いまま期限を過ぎた質問は、エージェントが何で進んだかが分からないので、その旨を出す
function ProceededSummary({ question, workspace }: { question: Question; workspace?: string }) {
  return (
    <span class="text-body flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span class="text-micro shrink-0 font-mono text-ink-tertiary">Q{question.id}</span>
      {workspace ? <span class="text-micro shrink-0 text-ink-subtle">{workspace}</span> : null}
      <span class="min-w-0 flex-1 truncate font-medium text-ink">{question.title}</span>
      <span class="text-small w-full min-w-0 truncate text-ink-subtle sm:w-auto sm:max-w-[45%]">
        {question.defaultAction ? (
          <>
            <span class="text-ink-tertiary">Default </span>
            {question.defaultAction}
          </>
        ) : (
          <span class="text-ink-tertiary">Deadline passed, no default</span>
        )}
      </span>
    </span>
  )
}
