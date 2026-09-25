import type { ComponentChildren } from "preact"
import { useEffect, useState } from "preact/hooks"
import { PriorityIcon } from "../../components/icons/priority-icon"
import { StatusIcon } from "../../components/icons/status-icon"
import { Avatar } from "../../components/avatar"
import { LabelChip } from "../../components/label-chip"
import { PRIORITIES, type Issue } from "../../store"
import { relativeTime } from "../../time"
import type { DraftField } from "../state"
import { issueColumns, pageHref, priorityLabel, statusLabel, type PageFilters } from "../view-model"
import { blurOnEnter, FIELD, PropRow, SelectBox } from "./fields"
import { EmptyAvatar } from "../../components/empty-avatar"

// issue 画面の属性欄 (状態・優先度・担当者・ラベル・期限・親・止めている issue)
// 属性は変えたとき、文字の欄は離れたときに、その項目だけを保存する

export function Properties({
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
        <SelectBox name="status" value={issue.status} onChange={commit("status")}>
          {statuses.map((status) => (
            <option value={status} selected={status === issue.status}>
              {statusLabel(status)}
            </option>
          ))}
        </SelectBox>
      </PropRow>
      <PropRow label="Priority" icon={<PriorityIcon priority={issue.priority} />}>
        <SelectBox name="priority" value={issue.priority ?? ""} onChange={commit("priority")}>
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
  display: ComponentChildren
  link?: string
  input: (onDone: () => void) => ComponentChildren
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
            // Button の sm (高さ 28px) を置くと値の行が上下の余白の分だけ高くなり、ほかの属性の行とそろわなくなるので、文字だけの小さなボタンにする
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
