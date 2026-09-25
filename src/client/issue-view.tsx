import { Button } from "../components/button"
import { ChevronRightIcon, CrossIcon } from "../components/icons"
import { QuestionAnswerForm, QuestionCard } from "../components/question-card"
import { Section } from "../components/section"
import type { Question } from "../questions"
import type { Comment, Issue } from "../store"
import { Activity } from "./issue/activity"
import { Description } from "./issue/description"
import { AutoGrowTextarea } from "./issue/fields"
import { FilterInputs } from "./issue/filter-inputs"
import { Properties } from "./issue/properties"
import { Relations, SubIssues } from "./issue/relations"
import type { DraftField, SaveState } from "./state"
import { pageHref, type PageFilters } from "./view-model"

// Linear の issue 画面にならい、左に題名・説明・子 issue・関係・質問・活動、右に属性を置く
// スマホ幅では 1 列にし、属性を題名の上に出す
// ここでは見出し・保存のフォーム・並び・コメントと回答のフォームだけを組み、各欄は ./issue/ に分ける

export function IssueView({
  issue,
  all,
  filters,
  error,
  labelInput,
  blockInput,
  comments,
  questions,
  draftDirty,
  saveState,
  onChange,
  onCommit,
  onSave,
}: {
  issue: Issue
  all: Issue[]
  filters: PageFilters
  error?: string
  labelInput: string
  blockInput: string
  comments: Comment[]
  questions: Question[]
  draftDirty: boolean
  saveState: SaveState
  onChange: (field: DraftField, value: string) => void
  onCommit: (field: DraftField, value: string) => Promise<void>
  onSave: () => Promise<void>
}) {
  const isNew = !issue.id
  const change =
    (field: DraftField) =>
    (event: Event): void => {
      const input = event.currentTarget as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
      onChange(field, input.value)
    }
  // その項目を保存する。属性は変えたとき、文字の欄は離れたときに呼ぶ
  const commit =
    (field: DraftField) =>
    (event: Event): void => {
      const input = event.currentTarget as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
      void onCommit(field, input.value)
    }
  const basePath = filters.basePath ?? ""
  const now = new Date()
  return (
    <aside
      id="issue-view"
      class="issue-view fixed inset-y-0 right-0 left-0 z-20 flex flex-col bg-canvas"
    >
      <form
        method="post"
        action={`${basePath}/issues`}
        class="flex min-h-0 flex-1 flex-col"
        onSubmit={(event: Event) => {
          event.preventDefault()
          void onSave()
        }}
      >
        <FilterInputs filters={filters} />
        {issue.id ? <input type="hidden" name="id" value={issue.id} /> : null}
        <header class="flex h-12 shrink-0 items-center gap-2 border-b border-hairline px-4">
          <a
            href={pageHref(filters)}
            class="text-[13px] text-ink-subtle no-underline hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-focus/50"
          >
            Issues
          </a>
          <ChevronRightIcon />
          <span class="font-mono text-[12px] text-ink">{isNew ? "New issue" : `#${issue.id}`}</span>
          <div class="ml-auto flex items-center gap-2">
            {isNew ? (
              <Button type="submit" variant="primary">
                Create issue
                <span class="font-mono text-[10px] text-on-primary/60">⌘⏎</span>
              </Button>
            ) : (
              <>
                <span aria-live="polite" class="text-[11px] text-ink-tertiary">
                  {saveState === "saving"
                    ? "Saving…"
                    : draftDirty
                      ? "Unsaved"
                      : saveState === "saved"
                        ? "Saved"
                        : ""}
                </span>
                {/* JavaScript が動かないときは自動保存されないので、保存のボタンを出す */}
                <noscript>
                  <Button type="submit" variant="primary">
                    Save
                  </Button>
                </noscript>
              </>
            )}
            <a
              id="drawer-close"
              href={pageHref(filters)}
              title="Close (Esc)"
              class="grid size-7 place-items-center rounded-md text-ink-tertiary no-underline transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
            >
              <CrossIcon />
            </a>
          </div>
        </header>
        {/* スマホ幅では 題名と説明 → 属性 → 残り の 1 列、広い画面では左に本文、右に属性を固定して並べる */}
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div class="md:grid md:min-h-full md:grid-cols-[minmax(0,1fr)_18rem]">
            <div class="md:col-start-1 md:row-start-1">
              <div class="mx-auto flex max-w-[760px] flex-col gap-3 px-4 pt-6 pb-2 md:px-10 md:pt-10">
                {error ? (
                  <p
                    role="alert"
                    class="rounded-md border border-semantic-danger/40 bg-semantic-danger/10 px-3 py-2 text-[13px] text-semantic-danger"
                  >
                    {error}
                  </p>
                ) : null}
                <AutoGrowTextarea
                  name="title"
                  value={issue.title}
                  onInput={change("title")}
                  onBlur={commit("title")}
                  placeholder="Issue title"
                  autofocus={isNew}
                  singleLine
                  class="w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-sans text-[22px] leading-snug font-semibold text-ink placeholder:text-ink-tertiary focus-visible:outline-none md:text-[26px]"
                />
                <Description
                  issue={issue}
                  startEditing={isNew}
                  onChangeBody={(body) => onChange("body", body)}
                  onCommitBody={(body) => void onCommit("body", body)}
                />
              </div>
            </div>
            <section class="my-4 border-y border-hairline px-4 py-3 md:col-start-2 md:row-span-2 md:row-start-1 md:my-0 md:border-y-0 md:border-l md:py-0">
              <div class="md:sticky md:top-0 md:py-5">
                <Properties
                  issue={issue}
                  all={all}
                  filters={filters}
                  labelInput={labelInput}
                  blockInput={blockInput}
                  change={change}
                  commit={commit}
                />
              </div>
            </section>
            <div class="md:col-start-1 md:row-start-2">
              {isNew ? null : (
                <div class="mx-auto flex max-w-[760px] flex-col gap-7 px-4 pt-4 pb-24 md:px-10 md:pt-6">
                  <SubIssues issue={issue} all={all} filters={filters} />
                  <Relations issue={issue} all={all} filters={filters} />
                  {questions.length > 0 ? (
                    <Section title="Questions">
                      {questions.map((question) => (
                        <QuestionCard question={question} now={now} />
                      ))}
                    </Section>
                  ) : null}
                  <Activity issue={issue} comments={comments} />
                  <div class="flex flex-col gap-2">
                    <textarea
                      form="comment-form"
                      name="body"
                      placeholder="Leave a comment…"
                      class="min-h-20 w-full resize-y rounded-lg border border-hairline bg-surface-1 p-3 font-sans text-[14px] text-ink placeholder:text-ink-tertiary focus:border-hairline-strong focus:outline-none"
                    />
                    <div class="flex justify-end">
                      <Button type="submit" form="comment-form">
                        Comment
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </form>
      {/* フォームは入れ子にできないので、コメントと回答のフォームは外に置き、入力欄を form 属性で結びつける */}
      {/* https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form */}
      {issue.id ? (
        <form id="comment-form" method="post" action={`${basePath}/comments`} hidden>
          <FilterInputs filters={filters} commentForm />
          <input type="hidden" name="issue" value={issue.id} />
        </form>
      ) : null}
      {questions.map((question) => (
        <QuestionAnswerForm
          question={question}
          basePath={basePath}
          returnTo={pageHref(filters, issue.id)}
        />
      ))}
    </aside>
  )
}
