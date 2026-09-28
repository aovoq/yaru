import { Alert } from "../components/alert"
import { AutoGrowTextarea } from "../components/auto-grow-textarea"
import { GroupLabel } from "../components/group-label"
import { QuestionAnswerForm } from "../components/question-answer-form"
import { isAwaitingAnswer, questionAnchorId } from "../components/question-answer"
import { QuestionCard } from "../components/question-card"
import { Section } from "../components/section"
import type { Issue } from "../domain/issue"
import type { Question } from "../domain/question"
import { Activity } from "./activity"
import { AwaitingQuestions } from "./awaiting-questions"
import { CommentComposer } from "./comment-composer"
import { Commits } from "./commits"
import { Description } from "./description"
import { pageHref } from "./filters"
import { IssueViewHeader } from "./issue-view-header"
import { KeyProperties } from "./key-properties"
import { MoreProperties } from "./more-properties"
import type {
  Comment,
  Commit,
  DraftField,
  IssueEvent,
  PageFilters,
  ReturnedDrafts,
  SaveInput,
  SaveState,
} from "./model"
import type { RelationKind } from "./relation-kind-switch"
import { Relations } from "./relations"
import { SubIssues } from "./sub-issues"
import { useCommentPosting } from "./use-comment-posting"
import { useDialogFocus } from "./use-dialog-focus"
import { useFieldCommit } from "./use-field-commit"

// 広い画面では左に本文、右に属性を置く。狭い画面では 1 列にする
// 1 列の並びは、答え待ちの質問 → 題名 → よく変える属性 → 説明 → 残りの属性 → 子 issue 以降
// 時刻は返事の now を渡す。ここでは new Date() を使わない

export type IssueViewProps = {
  issue: Issue
  all: Issue[]
  filters: PageFilters
  error?: string
  comments: Comment[]
  questions: Question[]
  events: IssueEvent[]
  commits: Commit[]
  viewer?: string
  now: Date
  draftDirty: boolean
  saveState: SaveState
  returnedDrafts: ReturnedDrafts
  questionError?: { questionId: string; message: string }
  onChange: (field: DraftField, value: string) => void
  onCommit: (field: DraftField, value: string) => Promise<void>
  onSave: () => Promise<void>
  onRetry: () => void
  onPatchIssue?: (issueId: string, input: Partial<SaveInput>) => Promise<void>
  onNavigate?: (href: string) => void
  onOpenMenu?: (anchor: HTMLElement) => void
  postComment: (body: string) => Promise<Comment>
}

const CONTENT = "mx-auto w-full max-w-[760px] px-4 md:px-10"

export function IssueView({
  issue,
  all,
  filters,
  error,
  comments,
  questions,
  events,
  commits,
  viewer,
  now,
  draftDirty,
  saveState,
  returnedDrafts,
  questionError,
  onChange,
  onCommit,
  onSave,
  onRetry,
  onPatchIssue,
  onNavigate,
  onOpenMenu,
  postComment,
}: IssueViewProps) {
  const isNew = !issue.id
  const basePath = filters.basePath ?? ""
  const issueHref = (id: string) => pageHref(filters, id)
  const returnTo = pageHref(filters, issue.id)
  const awaiting = questions.filter(isAwaitingAnswer)
  const settled = questions.filter((question) => !isAwaitingAnswer(question))
  useDialogFocus(issue.id)
  const fields = useFieldCommit<DraftField | "blockedBy">(issue.id)
  const commitField = (field: DraftField, value: string) =>
    void fields.run(field, () => onCommit(field, value))
  const patchBlocks = onPatchIssue
    ? (issueId: string, blocks: string[]) =>
        void fields.run("blockedBy", () => onPatchIssue(issueId, { blocks }))
    : undefined
  const toggleRelation = (kind: RelationKind, otherId: string) => {
    if (kind === "blocks") {
      const blocks = issue.blocks.includes(otherId)
        ? issue.blocks.filter((id) => id !== otherId)
        : [...issue.blocks, otherId]
      commitField("blocks", blocks.join(", "))
      return
    }
    const other = all.find((row) => row.id === otherId)
    if (!other || !patchBlocks) return
    patchBlocks(
      otherId,
      other.blocks.includes(issue.id)
        ? other.blocks.filter((id) => id !== issue.id)
        : [...other.blocks, issue.id],
    )
  }
  const posting = useCommentPosting({ issueId: issue.id, comments, post: postComment })

  // 普通のクリックのリンクは、ページを読み直さずに板の中で開く。修飾キーはブラウザに任せる
  const onLinkClick = (event: MouseEvent) => {
    if (!onNavigate || event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest("a[href]")
    const href = link?.getAttribute("href")
    if (!href || href.startsWith("#")) return
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return
    event.preventDefault()
    event.stopPropagation()
    onNavigate(href)
  }

  return (
    // 開いている間もサイドバーは使えるので aria-modal は付けない
    // https://www.w3.org/TR/wai-aria-1.2/#aria-modal
    <aside
      id="issue-view"
      role="dialog"
      aria-labelledby="issue-view-title"
      tabindex={-1}
      class="issue-view fixed inset-y-0 right-0 left-0 z-20 flex flex-col bg-canvas focus:outline-none"
      onClickCapture={onLinkClick}
    >
      <h1 id="issue-view-title" class="sr-only">
        {issue.title.trim() || "New issue"}
      </h1>
      <form
        method="post"
        action={`${basePath}/issues`}
        class="flex min-h-0 flex-1 flex-col"
        onSubmit={(event: Event) => {
          event.preventDefault()
          void onSave()
        }}
      >
        {issue.id ? <input type="hidden" name="id" value={issue.id} /> : null}
        <IssueViewHeader
          issueId={issue.id}
          title={issue.title}
          boardHref={pageHref(filters)}
          saveState={saveState}
          draftDirty={draftDirty}
          saveFailed={saveState === "failed"}
          onRetry={onRetry}
          onOpenMenu={issue.id && onOpenMenu ? onOpenMenu : undefined}
        />
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div class="flex flex-col lg:grid lg:min-h-full lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_auto_1fr]">
            <div class="order-1 lg:order-none lg:col-start-1 lg:row-start-1">
              <div class={`${CONTENT} flex flex-col gap-4 pt-6 pb-2 lg:pt-10`}>
                {error ? <Alert>{error}</Alert> : null}
                <AwaitingQuestions
                  questions={awaiting}
                  now={now}
                  answerDraft={returnedDrafts.answer}
                  questionError={questionError}
                />
                <AutoGrowTextarea
                  name="title"
                  aria-label="Issue title"
                  value={issue.title}
                  onInput={(event: Event) =>
                    onChange("title", (event.currentTarget as HTMLTextAreaElement).value)
                  }
                  onBlur={(event: Event) =>
                    commitField("title", (event.currentTarget as HTMLTextAreaElement).value)
                  }
                  placeholder="Issue title"
                  singleLine
                  class="w-full resize-none overflow-hidden border-0 border-b border-transparent bg-transparent p-0 pb-0.5 font-sans text-[22px] leading-snug font-semibold text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none md:text-display"
                />
              </div>
            </div>
            <div class="contents lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:block lg:border-l lg:border-hairline">
              <div class="contents lg:sticky lg:top-0 lg:flex lg:flex-col lg:gap-4 lg:px-4 lg:py-5">
                <section aria-label="Properties" class="order-2 lg:order-none">
                  <div class={`${CONTENT} lg:max-w-none lg:px-0`}>
                    <div class="border-y border-hairline py-2 lg:border-0 lg:py-0">
                      <GroupLabel class="mb-2 hidden lg:block">Properties</GroupLabel>
                      <KeyProperties
                        issue={issue}
                        all={all}
                        comments={comments}
                        viewer={viewer}
                        now={now}
                        errors={fields.errors}
                        onCommit={commitField}
                      />
                    </div>
                  </div>
                </section>
                <section aria-label="More properties" class="order-4 lg:order-none">
                  <div class={`${CONTENT} lg:max-w-none lg:px-0`}>
                    <div class="border-t border-hairline pt-2 lg:border-0 lg:pt-0">
                      <MoreProperties
                        issue={issue}
                        all={all}
                        filters={filters}
                        now={now}
                        errors={fields.errors}
                        onCommit={commitField}
                        onPatchBlocks={patchBlocks}
                      />
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div class="order-3 lg:order-none lg:col-start-1 lg:row-start-2">
              <div class={`${CONTENT} py-4 lg:pt-2`}>
                <Description
                  key={issue.id || "new"}
                  issue={issue}
                  isNew={isNew}
                  issueHref={issueHref}
                  onChangeBody={(body) => onChange("body", body)}
                  onCommitBody={(body) => commitField("body", body)}
                />
              </div>
            </div>
            <div class="order-5 lg:order-none lg:col-start-1 lg:row-start-3">
              {isNew ? null : (
                <div
                  class={`${CONTENT} mt-2 flex flex-col gap-8 pb-24 before:-mb-2 before:block before:border-t before:border-hairline`}
                >
                  <SubIssues issue={issue} all={all} filters={filters} now={now} />
                  <Relations
                    issue={issue}
                    all={all}
                    filters={filters}
                    now={now}
                    onToggle={toggleRelation}
                  />
                  {settled.length > 0 ? (
                    <Section title="Questions" count={settled.length}>
                      {settled.map((question) => (
                        <QuestionCard key={question.id} question={question} now={now} />
                      ))}
                    </Section>
                  ) : null}
                  <Commits commits={commits} now={now} />
                  <Activity
                    issue={issue}
                    comments={posting.comments}
                    events={events}
                    issueHref={issueHref}
                    now={now}
                  />
                  <CommentComposer
                    draft={returnedDrafts.comment}
                    error={posting.error}
                    pending={posting.pending}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </form>
      {issue.id ? (
        <form
          id="comment-form"
          method="post"
          action={`${basePath}/comments`}
          hidden
          onSubmit={(event: Event) => {
            event.preventDefault()
            void posting.submit(event.currentTarget as HTMLFormElement)
          }}
        >
          <input type="hidden" name="issue" value={issue.id} />
        </form>
      ) : null}
      {awaiting.map((question, index) => (
        <QuestionAnswerForm
          key={question.id}
          question={question}
          basePath={basePath}
          returnTo={returnTo}
          next={awaiting[index + 1] ? questionAnchorId(awaiting[index + 1]!) : undefined}
        />
      ))}
    </aside>
  )
}
