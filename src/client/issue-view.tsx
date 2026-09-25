import type { PropsWithChildren } from "hono/jsx"
import { useCallback, useEffect, useState } from "hono/jsx"
import { renderMarkdown, toggleTask } from "../markdown"
import { DEFAULT_VIEW } from "../page"
import type { Question } from "../questions"
import { PRIORITIES, type Comment, type Issue } from "../store"
import { relativeTime } from "../time"
import { ChevronIcon, CrossIcon, PriorityIcon, StatusIcon } from "./icons"
import { Avatar, LabelChip } from "./issue-metadata"
import type { DraftField, SaveState } from "./state"
import { issueColumns, pageHref, priorityLabel, statusLabel, type PageFilters } from "./view-model"

// Linear の issue 画面にならい、左に題名・説明・子 issue・関係・質問・活動、右に属性を置く
// スマホ幅では 1 列にし、属性を題名の上に出す

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
          <span class="text-ink-tertiary">
            <ChevronRightIcon />
          </span>
          <span class="font-mono text-[12px] text-ink">{isNew ? "New issue" : `#${issue.id}`}</span>
          <div class="ml-auto flex items-center gap-2">
            {isNew ? (
              <button
                type="submit"
                class="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-primary px-3 font-sans text-xs font-medium text-on-primary transition-colors hover:bg-primary-hover active:bg-primary-focus focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-focus/50"
              >
                Create issue
                <span class="font-mono text-[10px] text-on-primary/60">⌘⏎</span>
              </button>
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
                  <button
                    type="submit"
                    class="inline-flex h-7 cursor-pointer items-center rounded-md border-0 bg-primary px-3 font-sans text-xs font-medium text-on-primary"
                  >
                    Save
                  </button>
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
                        <IssueQuestion question={question} />
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
                      <button
                        type="submit"
                        form="comment-form"
                        class="inline-flex h-7 cursor-pointer items-center rounded-md border border-hairline bg-surface-2 px-3 font-sans text-xs font-medium text-ink hover:bg-surface-3"
                      >
                        Comment
                      </button>
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
      {questions.filter(isAwaiting).map((question) => (
        <form
          id={answerFormId(question)}
          method="post"
          action={`${basePath}/questions/${encodeURIComponent(question.id)}/answer`}
          hidden
        >
          <input type="hidden" name="returnTo" value={pageHref(filters, issue.id)} />
        </form>
      ))}
    </aside>
  )
}

// 板の絞り込みを保ったまま戻れるよう、フォームの送信に今の絞り込みを載せる
// issue の保存では status が issue の属性と重なるので、絞り込みの status は filter_status で送る
function FilterInputs({
  filters,
  commentForm = false,
}: {
  filters: PageFilters
  commentForm?: boolean
}) {
  return (
    <>
      {filters.query ? <input type="hidden" name="query" value={filters.query} /> : null}
      {filters.view && filters.view !== DEFAULT_VIEW ? (
        <input type="hidden" name="view" value={filters.view} />
      ) : null}
      {filters.status ? (
        <input
          type="hidden"
          name={commentForm ? "status" : "filter_status"}
          value={filters.status}
        />
      ) : null}
      {filters.assignee ? (
        <input
          type="hidden"
          name={commentForm ? "assignee" : "filter_assignee"}
          value={filters.assignee}
        />
      ) : null}
      {filters.label ? <input type="hidden" name="label" value={filters.label} /> : null}
    </>
  )
}

// 説明は描画した Markdown を見せ、押すと生の Markdown の編集に切り替える
// チェックボックスはその場で [ ] と [x] を切り替える
function Description({
  issue,
  startEditing,
  onChangeBody,
  onCommitBody,
}: {
  issue: Issue
  startEditing: boolean
  onChangeBody: (body: string) => void
  onCommitBody: (body: string) => void
}) {
  const [editing, setEditing] = useState(startEditing)
  useEffect(() => {
    if (!editing) return
    document.querySelector<HTMLTextAreaElement>("#issue-description-editor")?.focus()
  }, [editing])
  const onPreviewClick = useCallback(
    (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target instanceof HTMLInputElement && target.dataset.taskIndex !== undefined) {
        event.preventDefault()
        onCommitBody(toggleTask(issue.body, Number(target.dataset.taskIndex)))
        return
      }
      if (target.closest("a")) return
      setEditing(true)
    },
    [issue.body, onCommitBody],
  )
  if (editing) {
    return (
      <div class="flex flex-col gap-1.5">
        <AutoGrowTextarea
          id="issue-description-editor"
          name="body"
          value={issue.body}
          onInput={(event: Event) =>
            onChangeBody((event.currentTarget as HTMLTextAreaElement).value)
          }
          onBlur={(event: Event) => {
            if (!startEditing) onCommitBody((event.currentTarget as HTMLTextAreaElement).value)
          }}
          onKeyDown={(event: KeyboardEvent) => {
            // Esc は issue を閉じずに、説明の編集だけを終える。離れたときと同じく保存する
            if (event.key !== "Escape") return
            event.stopPropagation()
            if (!startEditing) onCommitBody((event.currentTarget as HTMLTextAreaElement).value)
            setEditing(false)
          }}
          placeholder="Add description… (Markdown)"
          class="min-h-40 w-full resize-none overflow-hidden rounded-md border border-hairline bg-surface-1 p-3 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-tertiary focus:border-hairline-strong focus:outline-none"
        />
        {startEditing ? null : (
          <div class="flex items-center gap-2 text-[11px] text-ink-tertiary">
            <span>Markdown</span>
            <button
              type="button"
              onClick={() => setEditing(false)}
              class="ml-auto cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 font-sans text-[11px] text-ink-subtle hover:bg-surface-2 hover:text-ink"
            >
              Preview (Esc)
            </button>
          </div>
        )}
      </div>
    )
  }
  if (!issue.body.trim()) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        class="w-full cursor-text rounded-md border-0 bg-transparent px-0 py-1 text-left font-sans text-[14px] text-ink-tertiary hover:text-ink-subtle"
      >
        Add description…
      </button>
    )
  }
  return (
    <div
      id="issue-description-preview"
      role="button"
      tabindex={0}
      title="Click to edit"
      onClick={onPreviewClick}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter" && event.target === event.currentTarget) setEditing(true)
      }}
      class="markdown -mx-2 cursor-text rounded-md px-2 py-1 transition-colors hover:bg-surface-1 focus-visible:outline-2 focus-visible:outline-primary-focus/50"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(issue.body) }}
    />
  )
}

function SubIssues({ issue, all, filters }: { issue: Issue; all: Issue[]; filters: PageFilters }) {
  const children = all.filter((other) => other.parent === issue.id)
  if (children.length === 0) return null
  const done = children.filter((child) => child.status === "done").length
  return (
    <Section
      title="Sub-issues"
      aside={
        <span class="flex items-center gap-2 text-[11px] text-ink-tertiary tabular-nums">
          <span class="h-1 w-16 overflow-hidden rounded-full bg-surface-3">
            <span
              class="block h-full rounded-full bg-primary"
              style={`width: ${Math.round((done / children.length) * 100)}%`}
            />
          </span>
          {done}/{children.length}
        </span>
      }
    >
      <IssueLinks issues={children} filters={filters} />
    </Section>
  )
}

function Relations({ issue, all, filters }: { issue: Issue; all: Issue[]; filters: PageFilters }) {
  const byId = new Map(all.map((other) => [other.id, other]))
  const blockedBy = issue.blockedBy.map((id) => byId.get(id)).filter((row) => row !== undefined)
  const blocks = issue.blocks.map((id) => byId.get(id)).filter((row) => row !== undefined)
  if (blockedBy.length === 0 && blocks.length === 0) return null
  return (
    <>
      {blockedBy.length > 0 ? (
        <Section title="Blocked by">
          <IssueLinks issues={blockedBy} filters={filters} />
        </Section>
      ) : null}
      {blocks.length > 0 ? (
        <Section title="Blocks">
          <IssueLinks issues={blocks} filters={filters} />
        </Section>
      ) : null}
    </>
  )
}

function IssueLinks({ issues, filters }: { issues: Issue[]; filters: PageFilters }) {
  return (
    <ul class="flex flex-col overflow-hidden rounded-lg border border-hairline">
      {issues.map((row) => (
        <li class="border-b border-hairline last:border-b-0">
          <a
            href={pageHref(filters, row.id)}
            class="flex h-9 items-center gap-2.5 px-3 no-underline transition-colors hover:bg-surface-1"
          >
            <PriorityIcon priority={row.priority} />
            <span class="w-10 shrink-0 font-mono text-[11px] text-ink-tertiary">#{row.id}</span>
            <StatusIcon status={row.status} />
            <span
              class={`min-w-0 flex-1 truncate text-[13px] ${
                row.status === "done" || row.status === "canceled" ? "text-ink-subtle" : "text-ink"
              }`}
            >
              {row.title}
            </span>
            {row.assignee ? <Avatar name={row.assignee} /> : null}
          </a>
        </li>
      ))}
    </ul>
  )
}

type ActivityEntry =
  | { kind: "event"; at: string; order: number; text: string; status: string }
  | { kind: "comment"; at: string; order: number; comment: Comment }

// issue が作られた・始まった・終わった時刻とコメントを、時刻順の 1 本の流れにする
// 時刻が同じときは作成 → 開始 → 完了 → コメントの順に並べる
function Activity({ issue, comments }: { issue: Issue; comments: Comment[] }) {
  const entries: ActivityEntry[] = []
  if (issue.createdAt) {
    entries.push({
      kind: "event",
      at: issue.createdAt,
      order: 0,
      text: "created the issue",
      status: "todo",
    })
  }
  if (issue.startedAt) {
    entries.push({
      kind: "event",
      at: issue.startedAt,
      order: 1,
      text: "started working",
      status: "in_progress",
    })
  }
  if (issue.completedAt) {
    entries.push({
      kind: "event",
      at: issue.completedAt,
      order: 2,
      text: "completed the issue",
      status: "done",
    })
  }
  if (issue.canceledAt) {
    entries.push({
      kind: "event",
      at: issue.canceledAt,
      order: 2,
      text: "canceled the issue",
      status: "canceled",
    })
  }
  for (const comment of comments) {
    entries.push({ kind: "comment", at: comment.createdAt, order: 3, comment })
  }
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order)
  const now = new Date()
  return (
    <Section title="Activity">
      <ol class="flex flex-col gap-3">
        {entries.map((entry) =>
          entry.kind === "event" ? (
            <li class="flex items-center gap-2.5 pl-1 text-[12px] text-ink-tertiary">
              <StatusIcon status={entry.status} />
              <span>
                {entry.text}
                <span class="mx-1.5">·</span>
                <time datetime={entry.at} title={entry.at}>
                  {relativeTime(entry.at, now)}
                </time>
              </span>
            </li>
          ) : (
            <li class="rounded-lg border border-hairline bg-surface-1 px-3.5 py-2.5">
              <div class="mb-1.5 flex items-center gap-2 text-[12px]">
                <Avatar name={entry.comment.author} />
                <span class="font-medium text-ink">{entry.comment.author}</span>
                {entry.comment.parent ? (
                  <span class="text-ink-tertiary">replied to {entry.comment.parent}</span>
                ) : null}
                <time datetime={entry.at} title={entry.at} class="text-ink-tertiary">
                  {relativeTime(entry.at, now)}
                </time>
              </div>
              <div
                class="markdown markdown-compact"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.comment.body) }}
              />
            </li>
          ),
        )}
      </ol>
    </Section>
  )
}

function Properties({
  issue,
  all,
  filters,
  labelInput,
  blockInput,
  change,
  commit,
}: {
  issue: Issue
  all: Issue[]
  filters: PageFilters
  labelInput: string
  blockInput: string
  change: (field: DraftField) => (event: Event) => void
  commit: (field: DraftField) => (event: Event) => void
}) {
  const statuses = issueColumns([issue])
  const parent = issue.parent ? all.find((row) => row.id === issue.parent) : undefined
  const now = new Date()
  return (
    <div class="flex flex-col gap-0.5">
      <div class="mb-2 hidden text-[11px] font-medium text-ink-tertiary md:block">Properties</div>
      <PropRow label="Status" icon={<StatusIcon status={issue.status} />}>
        <SelectBox name="status" value={issue.status} onInput={commit("status")}>
          {statuses.map((status) => (
            <option value={status} selected={status === issue.status}>
              {statusLabel(status)}
            </option>
          ))}
        </SelectBox>
      </PropRow>
      <PropRow label="Priority" icon={<PriorityIcon priority={issue.priority} />}>
        <SelectBox name="priority" value={issue.priority ?? ""} onInput={commit("priority")}>
          <option value="" selected={!issue.priority}>
            No priority
          </option>
          {PRIORITIES.map((priority) => (
            <option value={priority} selected={issue.priority === priority}>
              {priorityLabel(priority)}
            </option>
          ))}
        </SelectBox>
      </PropRow>
      <PropRow
        label="Assignee"
        icon={issue.assignee ? <Avatar name={issue.assignee} /> : <EmptyAvatar />}
      >
        <input
          name="assignee"
          value={issue.assignee ?? ""}
          onInput={change("assignee")}
          onBlur={commit("assignee")}
          onKeyDown={blurOnEnter}
          placeholder="Unassigned"
          class={FIELD}
        />
      </PropRow>
      <PropRow label="Labels">
        <EditableValue
          empty={issue.labels.length === 0}
          emptyText="Add labels"
          display={
            <span class="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <LabelChip label={label} />
              ))}
            </span>
          }
          input={(onDone) => (
            <input
              data-editing=""
              name="labels"
              value={labelInput}
              onInput={change("labels")}
              onBlur={(event: Event) => {
                commit("labels")(event)
                onDone()
              }}
              onKeyDown={blurOnEnter}
              placeholder="Comma separated"
              class={FIELD}
            />
          )}
        />
      </PropRow>
      <PropRow label="Due date">
        <input
          type="date"
          name="dueDate"
          value={issue.dueDate ?? ""}
          onChange={commit("dueDate")}
          class={FIELD}
        />
      </PropRow>
      <PropRow label="Parent">
        <EditableValue
          empty={!issue.parent}
          emptyText="Set parent"
          display={
            parent ? (
              <span class="flex min-w-0 items-center gap-1.5">
                <StatusIcon status={parent.status} />
                <span class="truncate">{parent.title}</span>
              </span>
            ) : (
              <span class="font-mono">#{issue.parent}</span>
            )
          }
          link={parent ? pageHref(filters, parent.id) : undefined}
          input={(onDone) => (
            <input
              data-editing=""
              name="parent"
              value={issue.parent ?? ""}
              onInput={change("parent")}
              onBlur={(event: Event) => {
                commit("parent")(event)
                onDone()
              }}
              onKeyDown={blurOnEnter}
              placeholder="Issue id"
              class={FIELD}
            />
          )}
        />
      </PropRow>
      <PropRow label="Blocks">
        <EditableValue
          empty={issue.blocks.length === 0}
          emptyText="Add blocked issues"
          display={<span class="font-mono">{issue.blocks.map((id) => `#${id}`).join(", ")}</span>}
          input={(onDone) => (
            <input
              data-editing=""
              name="blocks"
              value={blockInput}
              onInput={change("blocks")}
              onBlur={(event: Event) => {
                commit("blocks")(event)
                onDone()
              }}
              onKeyDown={blurOnEnter}
              placeholder="Issue ids, comma separated"
              class={FIELD}
            />
          )}
        />
      </PropRow>
      {issue.createdAt ? (
        <div class="mt-3 hidden flex-col gap-1 border-t border-hairline pt-3 text-[11px] text-ink-tertiary md:flex">
          <span title={issue.createdAt}>Created {relativeTime(issue.createdAt, now)}</span>
          {issue.updatedAt ? (
            <span title={issue.updatedAt}>Updated {relativeTime(issue.updatedAt, now)}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// 属性の値を見せておき、押すと入力に切り替える。入力を離れたら値の表示に戻る
// 表示中は入力がフォームに無いので、JavaScript なしの送信ではその属性を変えない
function EditableValue({
  empty,
  emptyText,
  display,
  link,
  input,
}: {
  empty: boolean
  emptyText: string
  display: unknown
  link?: string
  input: (onDone: () => void) => unknown
}) {
  const [editing, setEditing] = useState(false)
  // 切り替えた直後に入力へ focus を当てる。入力には data-editing を付けておく
  useEffect(() => {
    if (!editing) return
    document.querySelector<HTMLInputElement>("#issue-view input[data-editing]")?.focus()
  }, [editing])
  if (editing) {
    return <>{input(() => setEditing(false))}</>
  }
  return (
    <span class="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-[13px]">
      {empty ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          class="cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] text-ink-tertiary hover:text-ink-subtle"
        >
          {emptyText}
        </button>
      ) : (
        <>
          {link ? (
            <a href={link} class="min-w-0 truncate text-ink no-underline hover:underline">
              {display}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              class="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left font-sans text-[13px] text-ink"
            >
              {display}
            </button>
          )}
          {link ? (
            <button
              type="button"
              title="Change"
              onClick={() => setEditing(true)}
              class="ml-auto shrink-0 cursor-pointer rounded border-0 bg-transparent px-1 font-sans text-[11px] text-ink-tertiary hover:bg-surface-2 hover:text-ink"
            >
              Edit
            </button>
          ) : null}
        </>
      )}
    </span>
  )
}

function IssueQuestion({ question }: { question: Question }) {
  const formId = answerFormId(question)
  const expired = question.status === "expired"
  return (
    <div
      data-question-status={question.status}
      class={`flex flex-col gap-2 rounded-lg border bg-surface-1 px-3.5 py-3 ${
        expired ? "border-semantic-danger/40" : "border-hairline"
      }`}
    >
      <div class="flex items-center gap-2 text-[11px] text-ink-tertiary">
        <span class="font-mono">Q{question.id}</span>
        <span
          class={
            expired
              ? "text-semantic-danger"
              : question.status === "open"
                ? "text-primary-hover"
                : ""
          }
        >
          {question.status}
        </span>
        {question.priority ? <span>{question.priority}</span> : null}
      </div>
      <p class="text-[14px] font-medium text-ink">{question.title}</p>
      {question.body ? (
        <div
          class="markdown markdown-compact"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(question.body) }}
        />
      ) : null}
      {question.defaultAction ? (
        <p class="rounded-md border border-hairline bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-muted">
          <span class="mr-1.5 text-[11px] text-ink-tertiary">
            {expired ? "Proceeding with default" : "Default"}
          </span>
          {question.defaultAction}
        </p>
      ) : null}
      {question.answer !== null ? (
        <div
          class="markdown markdown-compact border-l-2 border-primary pl-2.5"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(question.answer) }}
        />
      ) : null}
      {isAwaiting(question) ? (
        <>
          <textarea
            form={formId}
            name="body"
            placeholder="Answer"
            class="h-16 w-full resize-y rounded-md border border-hairline bg-canvas p-2 font-sans text-[13px] text-ink placeholder:text-ink-tertiary focus:border-hairline-strong focus:outline-none"
          />
          <div class="flex gap-2">
            <button
              type="submit"
              form={formId}
              class="inline-flex h-7 cursor-pointer items-center rounded-md border-0 bg-primary px-3 font-sans text-xs font-medium text-on-primary hover:bg-primary-hover"
            >
              Answer
            </button>
            {question.defaultAction ? (
              <button
                type="submit"
                form={formId}
                name="useDefault"
                value="1"
                class="inline-flex h-7 cursor-pointer items-center rounded-md border border-hairline bg-transparent px-3 font-sans text-xs text-ink-muted hover:bg-surface-2"
              >
                Use default
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

// 1 行の入力欄では Enter で入力を終え、離れたときの保存に任せる
function blurOnEnter(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).blur()
}

function isAwaiting(question: Question): boolean {
  return question.status === "open" || question.status === "expired"
}

function answerFormId(question: Question): string {
  return `answer-question-${question.id}`
}

function Section({
  title,
  aside,
  children,
}: PropsWithChildren<{ title: string; aside?: unknown }>) {
  return (
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center gap-2">
        <h2 class="text-[13px] font-medium text-ink">{title}</h2>
        {aside ? <div class="ml-auto">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

// 中身に合わせて高さを伸ばす textarea。題名は改行を入れず 1 行の文として扱う
function AutoGrowTextarea({
  singleLine = false,
  onInput,
  ...props
}: {
  singleLine?: boolean
  onInput: (event: Event) => void
  [attribute: string]: unknown
}) {
  const resize = (element: HTMLTextAreaElement) => {
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }
  return (
    <textarea
      {...props}
      rows={1}
      ref={(element: HTMLTextAreaElement | null) => {
        if (element) requestAnimationFrame(() => resize(element))
      }}
      onInput={(event: Event) => {
        const element = event.currentTarget as HTMLTextAreaElement
        if (singleLine && element.value.includes("\n"))
          element.value = element.value.replace(/\n/g, " ")
        resize(element)
        onInput(event)
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (
          singleLine &&
          event.key === "Enter" &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.isComposing
        ) {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).blur()
        }
        const handler = props.onKeyDown as ((event: KeyboardEvent) => void) | undefined
        handler?.(event)
      }}
    />
  )
}

function ChevronRightIcon() {
  return (
    <svg class="size-3" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function EmptyAvatar() {
  return (
    <span class="grid size-[18px] shrink-0 place-items-center rounded-full border border-dashed border-hairline-strong" />
  )
}

const FIELD =
  "h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 font-sans text-[13px] text-ink transition-colors placeholder:text-ink-tertiary hover:bg-surface-2 focus-visible:border-hairline-strong focus-visible:bg-surface-2 focus-visible:outline-none"

function PropRow({ label, icon, children }: PropsWithChildren<{ label: string; icon?: unknown }>) {
  return (
    <label class="flex min-h-8 items-start gap-2">
      <span class="flex h-7 w-20 shrink-0 items-center text-[12px] text-ink-tertiary">{label}</span>
      <span class="flex min-w-0 flex-1 items-start">
        {icon ? <span class="flex h-7 shrink-0 items-center pl-2">{icon}</span> : null}
        {children}
      </span>
    </label>
  )
}

function SelectBox({
  name,
  value,
  onInput,
  children,
}: PropsWithChildren<{ name: string; value: string; onInput: (event: Event) => void }>) {
  return (
    <div class="relative w-full min-w-0">
      <select
        name={name}
        value={value}
        onInput={onInput}
        ref={(select: HTMLSelectElement | null) => {
          if (!select) return
          const onChange = (event: Event) => onInput(event)
          select.addEventListener("change", onChange)
          return () => select.removeEventListener("change", onChange)
        }}
        class={`${FIELD} appearance-none pr-7`}
      >
        {children}
      </select>
      <span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-tertiary">
        <ChevronIcon />
      </span>
    </div>
  )
}
