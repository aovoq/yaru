import { Avatar } from "../../components/avatar"
import { EmptyAvatar } from "../../components/empty-avatar"
import { PriorityIcon } from "../../components/icons/priority-icon"
import { StatusIcon } from "../../components/icons/status-icon"
import type { Comment, Issue } from "../../store"
import type { DraftField } from "../state"
import { priorityLabel, statusLabel } from "../view-model"
import { DueDateValue } from "./due-date-value"
import { PropRow } from "./prop-row"
import { PropertyPicker } from "./property-picker"
import { PropertyValueButton } from "./property-value-button"
import { assigneeOptions, NO_VALUE, priorityOptions, statusOptions } from "./property-options"
import type { FieldErrors } from "./use-field-commit"

// issue 画面の属性のうち、よく変える 4 つ (状態・優先度・担当者・期日)
// スマホ幅では題名のすぐ下に出し、説明を読み飛ばさなくても状態を変えられるようにする。広い画面では右の欄の上に置く
// 選んだらその項目だけを保存する。保存に失敗したら行の下に理由を出す (use-field-commit.ts)

export function KeyProperties({
  issue,
  all,
  comments,
  viewer,
  now,
  errors,
  onCommit,
}: {
  issue: Issue
  all: Issue[]
  comments: Comment[]
  viewer?: string
  now: Date
  errors: FieldErrors
  onCommit: (field: DraftField, value: string) => void
}) {
  return (
    <div class="flex flex-col gap-0.5">
      <PropRow
        property="status"
        label="Status"
        labelId="issue-property-status"
        icon={<StatusIcon status={issue.status} decorative />}
        error={errors.status}
      >
        <PropertyPicker
          label="Status"
          options={statusOptions(issue)}
          selected={[issue.status]}
          onSelect={(value) => onCommit("status", value)}
          trigger={(trigger) => (
            <PropertyValueButton trigger={trigger} labelledBy="issue-property-status">
              {statusLabel(issue.status)}
            </PropertyValueButton>
          )}
        />
      </PropRow>
      <PropRow
        property="priority"
        label="Priority"
        labelId="issue-property-priority"
        icon={<PriorityIcon priority={issue.priority} decorative />}
        error={errors.priority}
      >
        <PropertyPicker
          label="Priority"
          options={priorityOptions()}
          selected={[issue.priority ?? NO_VALUE]}
          onSelect={(value) => onCommit("priority", value)}
          trigger={(trigger) => (
            <PropertyValueButton
              trigger={trigger}
              labelledBy="issue-property-priority"
              empty={!issue.priority}
            >
              {issue.priority ? priorityLabel(issue.priority) : "No priority"}
            </PropertyValueButton>
          )}
        />
      </PropRow>
      <PropRow
        property="assignee"
        label="Assignee"
        labelId="issue-property-assignee"
        icon={issue.assignee ? <Avatar name={issue.assignee} /> : <EmptyAvatar />}
        error={errors.assignee}
      >
        <PropertyPicker
          label="Assignee"
          placeholder="Assign to…"
          options={assigneeOptions(all, comments, viewer)}
          selected={[issue.assignee ?? NO_VALUE]}
          onSelect={(value) => onCommit("assignee", value)}
          onCreate={(name) => onCommit("assignee", name)}
          createLabel={(name) => `Assign to "${name}"`}
          trigger={(trigger) => (
            <PropertyValueButton
              trigger={trigger}
              labelledBy="issue-property-assignee"
              empty={!issue.assignee}
            >
              {issue.assignee ?? "Unassigned"}
            </PropertyValueButton>
          )}
        />
      </PropRow>
      <PropRow
        property="dueDate"
        label="Due date"
        labelId="issue-property-due-date"
        error={errors.dueDate}
      >
        <DueDateValue
          dueDate={issue.dueDate}
          status={issue.status}
          now={now}
          labelledBy="issue-property-due-date"
          onCommit={(value) => onCommit("dueDate", value)}
        />
      </PropRow>
    </div>
  )
}
