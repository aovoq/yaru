import { Alert } from "../components/alert"
import { AutoGrowTextarea } from "../components/auto-grow-textarea"
import { GroupLabel } from "../components/group-label"
import { QuestionAnswerForm } from "../components/question-answer-form"
import { isAwaitingAnswer, questionAnchorId } from "../components/question-answer"
import { QuestionCard } from "../components/question-card"
import { Section } from "../components/section"
import type { IssueEvent } from "../issue-events"
import type { Question } from "../questions"
import type { IssueCommit } from "../repository"
import type { Comment, Issue, SaveInput } from "../store"
import { Activity } from "./issue/activity"
import { AwaitingQuestions } from "./issue/awaiting-questions"
import { CommentComposer } from "./issue/comment-composer"
import { Commits } from "./issue/commits"
import { Description } from "./issue/description"
import { FilterInputs } from "./issue/filter-inputs"
import { IssueViewHeader } from "./issue/issue-view-header"
import { KeyProperties } from "./issue/key-properties"
import { MoreProperties } from "./issue/more-properties"
import type { RelationKind } from "./issue/relation-kind-switch"
import { Relations } from "./issue/relations"
import { SubIssues } from "./issue/sub-issues"
import { useCommentPosting } from "./issue/use-comment-posting"
import { useDialogFocus } from "./issue/use-dialog-focus"
import { useFieldCommit } from "./issue/use-field-commit"
import { useIssueActions } from "./context-menu/issue-actions"
import type { DraftField, SaveState } from "./state"
import { pageHref, type PageFilters } from "./view-model"

// Linear の issue 画面にならい、広い画面 (lg 以上) では左に本文、右に属性を置く。それより狭い画面では 1 列にする
// 1 列のときの並びは、答え待ちの質問 → 題名 → よく変える属性 (状態・優先度・担当者・期日) → 説明 → 残りの属性 → 子 issue 以降
// 属性の 2 つのまとまりは広い画面では右の 1 つの欄に入れたいので、欄の枠を 1 列のときは display: contents にして、
// 中のまとまりを外の並び (flex の order) に直接並べる。そのため 1 列のときは、残りの属性が説明より先に focus の順に来る
// ここでは状態と部品をつなぐ組み立てと、保存のフォームだけを持ち、見出しの帯と各欄は ./issue/ に分ける

export type IssueViewProps = {
  issue: Issue
  all: Issue[]
  filters: PageFilters
  error?: string
  comments: Comment[]
  questions: Question[]
  // 開いている issue の属性の変更履歴 (古い順) と、関わるコミット (新しい順)
  events: IssueEvent[]
  commits: IssueCommit[]
  // 画面を見ている人の名前。分かれば担当者に「Assign to me」を出す
  viewer?: string
  draftDirty: boolean
  saveState: SaveState
  onChange: (field: DraftField, value: string) => void
  // 1 つの項目を保存する。失敗したら、その項目を保存済みの値に戻してから Error で断る
  onCommit: (field: DraftField, value: string) => Promise<void>
  onSave: () => Promise<void>
  // 開いていない issue の一部の項目を保存する。止められている issue (相手の blocks) を変えるのに使う。失敗したら Error で断る
  onPatchIssue?: (issueId: string, input: Partial<SaveInput>) => Promise<void>
  // 本文の #<id> のリンクを押したとき、ページを読み直さずにその issue を開く
  onNavigate?: (href: string) => void
}

// 1 列のときに中身の幅をそろえる枠。広い画面の左の欄でも同じ幅に収める
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
  draftDirty,
  saveState,
  onChange,
  onCommit,
  onSave,
  onPatchIssue,
  onNavigate,
}: IssueViewProps) {
  const isNew = !issue.id
  const basePath = filters.basePath ?? ""
  const now = new Date()
  const issueHref = (id: string) => pageHref(filters, id)
  const returnTo = pageHref(filters, issue.id)
  const awaiting = questions.filter(isAwaitingAnswer)
  const settled = questions.filter((question) => !isAwaitingAnswer(question))

  // 保存のやり直し・issue のメニュー・送り返された書きかけは、板の組み立て役 (app.tsx) が context で渡す
  const { retrySave, openIssueMenuAt, returnedDrafts } = useIssueActions()
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
  const posting = useCommentPosting({ basePath, issueId: issue.id, comments })

  // 本文の #<id> のリンク (data-issue) は、板の中で移るのでページを読み直さずに開く
  // 新しいタブで開くための修飾キーや中ボタンの押し方はブラウザに任せる
  const onContentClick = (event: MouseEvent) => {
    if (!onNavigate || event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest<HTMLAnchorElement>("a[data-issue]")
    const href = link?.getAttribute("href")
    if (!href) return
    event.preventDefault()
    onNavigate(href)
  }

  return (
    <aside
      id="issue-view"
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-view-title"
      tabindex={-1}
      class="issue-view fixed inset-y-0 right-0 left-0 z-20 flex flex-col bg-canvas focus:outline-none"
    >
      {/* 題名の欄は textarea なので見出しにならない。読み上げの見出しと dialog の名前のために、同じ題名の h1 を見えない形で置く */}
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
        <FilterInputs filters={filters} />
        {issue.id ? <input type="hidden" name="id" value={issue.id} /> : null}
        <IssueViewHeader
          issueId={issue.id}
          title={issue.title}
          boardHref={pageHref(filters)}
          saveState={saveState}
          draftDirty={draftDirty}
          saveFailed={saveState === "failed"}
          onRetry={() => void retrySave()}
          onOpenMenu={issue.id ? (anchor) => openIssueMenuAt(issue.id, anchor) : undefined}
        />
        <div class="min-h-0 flex-1 overflow-y-auto" onClick={onContentClick}>
          {/* 属性の欄は 3 行にまたがるので、題名と説明の行は中身の高さにし、余りは最後の行に回す。そうしないと説明が短いときに間が空く */}
          <div class="flex flex-col lg:grid lg:min-h-full lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_auto_1fr]">
            <div class="order-1 lg:order-none lg:col-start-1 lg:row-start-1">
              <div class={`${CONTENT} flex flex-col gap-4 pt-6 pb-2 lg:pt-10`}>
                {error ? <Alert>{error}</Alert> : null}
                <AwaitingQuestions
                  questions={awaiting}
                  now={now}
                  answerDraft={returnedDrafts.answer}
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
                  // 題名は大きな字をそのまま見せたいので枠を付けず、focus したら下に primary の線を引いて打っている場所を示す
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
                    {/* 下の子 issue 以降との間には、あちらの上の線があるので、ここは上だけに線を引く */}
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
                // 説明と、後から付いた欄 (子 issue・関係・質問・コミット・活動) の間に線を引き、どこまでが issue の本文かを分ける
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
      {/* フォームは入れ子にできないので、コメントと回答のフォームは外に置き、入力欄を form 属性で結びつける */}
      {/* https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form */}
      {/* スクリプトが動くときはコメントを fetch で送り、ページを読み直さずに活動欄へ足す。動かないときはこのフォームの POST がそのまま働く */}
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
          <FilterInputs filters={filters} commentForm />
          <input type="hidden" name="issue" value={issue.id} />
        </form>
      ) : null}
      {/* 質問は新しい順に並ぶので、key が無いと新着が先頭に入ったときに書きかけの回答が別の質問へ移る */}
      {/* 答えたあとは戻り先で次の答え待ちの質問を開けるよう、次のカードの id を渡す */}
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
