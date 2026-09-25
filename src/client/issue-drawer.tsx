import type { PropsWithChildren } from "hono/jsx"
import { DEFAULT_VIEW } from "../page"
import type { Question } from "../questions"
import { PRIORITIES, type Comment, type Issue } from "../store"
import { ChevronIcon, CrossIcon } from "./icons"
import type { DraftField } from "./state"
import { issueColumns, pageHref, priorityLabel, statusLabel, type PageFilters } from "./view-model"

export function IssueDrawer({
  issue,
  filters,
  error,
  labelInput,
  blockInput,
  comments,
  questions,
  onChange,
  onSave,
}: {
  issue: Issue
  filters: PageFilters
  error?: string
  labelInput: string
  blockInput: string
  comments: Comment[]
  questions: Question[]
  onChange: (field: DraftField, value: string) => void
  onSave: () => Promise<void>
}) {
  const statuses = issueColumns([issue])
  const change =
    (field: DraftField) =>
    (event: Event): void => {
      const input = event.currentTarget as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
      onChange(field, input.value)
    }
  return (
    <aside class="fixed inset-y-0 right-0 z-20 flex w-full max-w-[440px] flex-col border-l border-hairline bg-surface-1 shadow-2xl shadow-black/50">
      <form
        method="post"
        action="/issues"
        class="flex min-h-0 flex-1 flex-col"
        onSubmit={(event: Event) => {
          event.preventDefault()
          void onSave()
        }}
      >
        {filters.query ? <input type="hidden" name="query" value={filters.query} /> : null}
        {filters.view && filters.view !== DEFAULT_VIEW ? (
          <input type="hidden" name="view" value={filters.view} />
        ) : null}
        {filters.status ? (
          <input type="hidden" name="filter_status" value={filters.status} />
        ) : null}
        {filters.assignee ? (
          <input type="hidden" name="filter_assignee" value={filters.assignee} />
        ) : null}
        {filters.label ? <input type="hidden" name="label" value={filters.label} /> : null}
        {issue.id ? <input type="hidden" name="id" value={issue.id} /> : null}
        <div class="flex h-12 shrink-0 items-center gap-2 border-b border-hairline px-4">
          <span class="font-mono text-[11px] text-ink-tertiary">{issue.id || "New issue"}</span>
          <a
            id="drawer-close"
            href={pageHref(filters)}
            title="Close (Esc)"
            class="ml-auto grid size-6 place-items-center rounded-md text-ink-tertiary no-underline transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
          >
            <CrossIcon />
          </a>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {error ? (
            <p class="rounded-md border border-semantic-danger/40 bg-semantic-danger/10 px-3 py-2 text-[13px] text-semantic-danger">
              {error}
            </p>
          ) : null}
          <input
            name="title"
            value={issue.title}
            onInput={change("title")}
            placeholder="Issue title"
            autofocus={!issue.id}
            class="w-full border-0 bg-transparent px-0 font-sans text-[15px] font-semibold text-ink placeholder:text-ink-tertiary focus-visible:outline-none"
          />
          <div class="flex flex-col gap-2">
            <PropRow label="Status">
              <SelectBox name="status" value={issue.status} onInput={change("status")}>
                {statuses.map((status) => (
                  <option value={status} selected={status === issue.status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </SelectBox>
            </PropRow>
            <PropRow label="Priority">
              <SelectBox name="priority" value={issue.priority ?? ""} onInput={change("priority")}>
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
            <PropRow label="Assignee">
              <input
                name="assignee"
                value={issue.assignee ?? ""}
                onInput={change("assignee")}
                placeholder="Unassigned"
                class={FIELD}
              />
            </PropRow>
            <PropRow label="Due date">
              <input
                type="date"
                name="dueDate"
                value={issue.dueDate ?? ""}
                onInput={change("dueDate")}
                class={FIELD}
              />
            </PropRow>
            <PropRow label="Labels">
              <input
                name="labels"
                value={labelInput}
                onInput={change("labels")}
                placeholder="Comma separated"
                class={FIELD}
              />
            </PropRow>
            <PropRow label="Parent">
              <input
                name="parent"
                value={issue.parent ?? ""}
                onInput={change("parent")}
                placeholder="Issue id"
                class={FIELD}
              />
            </PropRow>
            <PropRow label="Blocks">
              <input
                name="blocks"
                value={blockInput}
                onInput={change("blocks")}
                placeholder="Comma separated ids"
                class={FIELD}
              />
            </PropRow>
            {issue.blockedBy.length > 0 ? (
              <PropRow label="Blocked by">
                <span class="font-mono text-[12px] text-ink">{issue.blockedBy.join(", ")}</span>
              </PropRow>
            ) : null}
            {issue.startedAt ? (
              <PropRow label="Started">
                <span class="font-mono text-[12px] text-ink-tertiary">{issue.startedAt}</span>
              </PropRow>
            ) : null}
            {issue.completedAt ? (
              <PropRow label="Completed">
                <span class="font-mono text-[12px] text-ink-tertiary">{issue.completedAt}</span>
              </PropRow>
            ) : null}
            {issue.canceledAt ? (
              <PropRow label="Canceled">
                <span class="font-mono text-[12px] text-ink-tertiary">{issue.canceledAt}</span>
              </PropRow>
            ) : null}
          </div>
          <div class="flex flex-1 flex-col gap-1.5 border-t border-hairline pt-4">
            <span class="text-xs text-ink-tertiary">Description</span>
            <textarea
              name="body"
              value={issue.body}
              onInput={change("body")}
              placeholder="Write a description…"
              class="min-h-40 w-full flex-1 resize-none border-0 bg-transparent p-0 font-sans text-[13px] leading-relaxed text-ink placeholder:text-ink-tertiary focus-visible:outline-none"
            />
          </div>
          {questions.length > 0 ? (
            <div class="flex flex-col gap-2 border-t border-hairline pt-4">
              <span class="text-xs text-ink-tertiary">Questions</span>
              {questions.map((question) => (
                <DrawerQuestion question={question} />
              ))}
            </div>
          ) : null}
          {issue.id ? (
            <div class="flex flex-col gap-2 border-t border-hairline pt-4">
              <span class="text-xs text-ink-tertiary">Comments</span>
              {comments.length === 0 ? (
                <p class="text-[12px] text-ink-tertiary">No comments</p>
              ) : (
                comments.map((comment) => (
                  <div class="rounded-md border border-hairline px-3 py-2">
                    <div class="text-[11px] text-ink-tertiary">
                      {comment.author}
                      {comment.parent ? ` · reply to ${comment.parent}` : ""}
                    </div>
                    <p class="mt-1 whitespace-pre-wrap text-[13px] text-ink">{comment.body}</p>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
        <div class="flex shrink-0 items-center justify-end gap-2 border-t border-hairline px-4 py-3">
          <a
            href={pageHref(filters)}
            class="inline-flex h-7 items-center rounded-md border border-hairline px-3 text-xs font-medium text-ink no-underline transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-focus/50"
          >
            Close
          </a>
          <button
            type="submit"
            class="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-primary px-3 font-sans text-xs font-medium text-on-primary transition-colors hover:bg-primary-hover active:bg-primary-focus focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-focus/50"
          >
            Save
            <span class="font-mono text-[10px] text-on-primary/60">⌘⏎</span>
          </button>
        </div>
      </form>
      {questions
        .filter((question) => isAwaiting(question))
        .map((question) => (
          <form
            id={answerFormId(question)}
            method="post"
            action={`/questions/${encodeURIComponent(question.id)}/answer`}
            hidden
          >
            <input type="hidden" name="returnTo" value={pageHref(filters, issue.id)} />
          </form>
        ))}
      {issue.id ? (
        <form method="post" action="/comments" class="shrink-0 border-t border-hairline px-4 py-3">
          {filters.query ? <input type="hidden" name="query" value={filters.query} /> : null}
          {filters.view && filters.view !== DEFAULT_VIEW ? (
            <input type="hidden" name="view" value={filters.view} />
          ) : null}
          {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
          {filters.assignee ? (
            <input type="hidden" name="assignee" value={filters.assignee} />
          ) : null}
          {filters.label ? <input type="hidden" name="label" value={filters.label} /> : null}
          <input type="hidden" name="issue" value={issue.id} />
          <textarea
            name="body"
            placeholder="Leave a comment…"
            class="mb-2 h-16 w-full resize-none rounded-md border border-hairline bg-transparent p-2 font-sans text-[13px] text-ink placeholder:text-ink-tertiary focus-visible:outline-none"
          />
          <button
            type="submit"
            class="inline-flex h-7 cursor-pointer items-center rounded-md border-0 bg-surface-2 px-3 font-sans text-xs font-medium text-ink hover:bg-surface-3"
          >
            Comment
          </button>
        </form>
      ) : null}
    </aside>
  )
}

function isAwaiting(question: Question): boolean {
  return question.status === "open" || question.status === "expired"
}

// 回答のフォームは issue を保存するフォームの外に置き、入力欄とボタンは form 属性でそこへ結びつける
// フォームは入れ子にできないため
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form
function answerFormId(question: Question): string {
  return `answer-question-${question.id}`
}

function DrawerQuestion({ question }: { question: Question }) {
  const formId = answerFormId(question)
  return (
    <div
      data-question-status={question.status}
      class={`flex flex-col gap-2 rounded-md border px-3 py-2 ${
        question.status === "expired" ? "border-semantic-danger/40" : "border-hairline"
      }`}
    >
      <div class="flex items-center gap-2 text-[11px] text-ink-tertiary">
        <span class="font-mono">Q{question.id}</span>
        <span class={question.status === "expired" ? "text-semantic-danger" : ""}>
          {question.status}
        </span>
        {question.priority ? <span>{question.priority}</span> : null}
      </div>
      <p class="text-[13px] font-medium text-ink">{question.title}</p>
      {question.body ? (
        <p class="whitespace-pre-wrap text-[12px] text-ink-muted">{question.body}</p>
      ) : null}
      {question.defaultAction ? (
        <p class="text-[12px] text-ink-muted">
          <span class="mr-1.5 text-[11px] text-ink-tertiary">Default</span>
          {question.defaultAction}
        </p>
      ) : null}
      {question.answer !== null ? (
        <p class="border-l-2 border-primary pl-2 whitespace-pre-wrap text-[13px] text-ink">
          {question.answer}
        </p>
      ) : null}
      {isAwaiting(question) ? (
        <>
          <textarea
            form={formId}
            name="body"
            placeholder="Answer"
            class="h-14 w-full resize-none rounded-md border border-hairline bg-transparent p-2 font-sans text-[13px] text-ink placeholder:text-ink-tertiary focus-visible:outline-none"
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

const FIELD =
  "h-7 w-full rounded-md border border-transparent bg-transparent px-2 font-sans text-[13px] text-ink transition-colors placeholder:text-ink-tertiary hover:bg-surface-2 focus-visible:border-hairline-strong focus-visible:bg-surface-2 focus-visible:outline-none"

function PropRow({ label, children }: PropsWithChildren<{ label: string }>) {
  return (
    <label class="flex items-center gap-3">
      <span class="w-20 shrink-0 text-xs text-ink-tertiary">{label}</span>
      {children}
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
    <div class="relative w-fit">
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
        class={`${FIELD} w-auto appearance-none pr-7`}
      >
        {children}
      </select>
      <span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-tertiary">
        <ChevronIcon />
      </span>
    </div>
  )
}
