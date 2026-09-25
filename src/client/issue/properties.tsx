import { PriorityIcon } from "../../components/icons/priority-icon"
import { StatusIcon } from "../../components/icons/status-icon"
import { Avatar } from "../../components/avatar"
import { EmptyAvatar } from "../../components/empty-avatar"
import { GroupLabel } from "../../components/group-label"
import { InlineInput } from "../../components/inline-input"
import { InlineSelect } from "../../components/inline-select"
import { LabelChip } from "../../components/label-chip"
import { RelativeTime } from "../../components/relative-time"
import { PRIORITIES, type Issue } from "../../store"
import type { DraftField } from "../state"
import { issueColumns, pageHref, priorityLabel, statusLabel, type PageFilters } from "../view-model"
import { EditableTextInput } from "./editable-text-input"
import { EditableValue } from "./editable-value"
import { PropRow } from "./prop-row"

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
      <GroupLabel class="mb-2 hidden md:block">Properties</GroupLabel>
      <PropRow label="Status" icon={<StatusIcon status={issue.status} />}>
        <InlineSelect name="status" value={issue.status} onChange={commit("status")}>
          {statuses.map((status) => (
            <option value={status} selected={status === issue.status}>
              {statusLabel(status)}
            </option>
          ))}
        </InlineSelect>
      </PropRow>
      <PropRow label="Priority" icon={<PriorityIcon priority={issue.priority} />}>
        <InlineSelect name="priority" value={issue.priority ?? ""} onChange={commit("priority")}>
          <option value="" selected={!issue.priority}>
            No priority
          </option>
          {PRIORITIES.map((priority) => (
            <option value={priority} selected={issue.priority === priority}>
              {priorityLabel(priority)}
            </option>
          ))}
        </InlineSelect>
      </PropRow>
      <PropRow
        label="Assignee"
        icon={issue.assignee ? <Avatar name={issue.assignee} /> : <EmptyAvatar />}
      >
        <InlineInput
          name="assignee"
          value={issue.assignee ?? ""}
          onInput={change("assignee")}
          onBlur={commit("assignee")}
          placeholder="Unassigned"
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
            <EditableTextInput
              name="labels"
              value={labelInput}
              placeholder="Comma separated"
              onInput={change("labels")}
              onCommit={commit("labels")}
              onDone={onDone}
            />
          )}
        />
      </PropRow>
      <PropRow label="Due date">
        <InlineInput
          type="date"
          name="dueDate"
          value={issue.dueDate ?? ""}
          onChange={commit("dueDate")}
          onKeyDown={null}
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
            <EditableTextInput
              name="parent"
              value={issue.parent ?? ""}
              placeholder="Issue id"
              onInput={change("parent")}
              onCommit={commit("parent")}
              onDone={onDone}
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
            <EditableTextInput
              name="blocks"
              value={blockInput}
              placeholder="Issue ids, comma separated"
              onInput={change("blocks")}
              onCommit={commit("blocks")}
              onDone={onDone}
            />
          )}
        />
      </PropRow>
      {issue.createdAt ? (
        <div class="mt-3 hidden flex-col gap-1 border-t border-hairline pt-3 text-[11px] text-ink-tertiary md:flex">
          <RelativeTime at={issue.createdAt} now={now} prefix="Created " />
          {issue.updatedAt ? (
            <RelativeTime at={issue.updatedAt} now={now} prefix="Updated " />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
