import type { ComboboxOption } from "../components/combobox"
import { Avatar } from "../components/avatar"
import { EmptyAvatar } from "../components/empty-avatar"
import { PriorityIcon } from "../components/icons/priority-icon"
import { StatusIcon } from "../components/icons/status-icon"
import { LabelDot } from "../components/label-dot"
import { labelColors } from "../components/tint"
import { PRIORITIES, type Issue } from "../domain/issue"
import { issueColumns, priorityLabel, statusLabel } from "./filters"
import type { Comment } from "./model"

// issue 画面の属性の選択の面に並べる候補
// 値の無いことを選べる属性 (優先度・担当者・親) は、先頭に「無し」の候補を value "" で置く。保存では "" が null になる

export const NO_VALUE = ""

export function statusOptions(issue: Issue): ComboboxOption[] {
  return issueColumns([issue]).map((status) => ({
    value: status,
    label: statusLabel(status),
    icon: <StatusIcon status={status} decorative />,
    keywords: status === "in_progress" ? ["doing", "started", "wip"] : [],
  }))
}

export function priorityOptions(): ComboboxOption[] {
  return [
    { value: NO_VALUE, label: "No priority", icon: <PriorityIcon priority={null} decorative /> },
    ...PRIORITIES.map((priority) => ({
      value: priority,
      label: priorityLabel(priority),
      icon: <PriorityIcon priority={priority} decorative />,
    })),
  ]
}

// 担当者の候補は、issue に付いている担当者とコメントを書いた人から作る
// 画面を見ている人 (viewer) が分かるときは、「Assign to me」を「無し」の次に置く
export function assigneeOptions(
  all: Issue[],
  comments: Comment[],
  viewer: string | undefined,
): ComboboxOption[] {
  const people = new Set<string>()
  for (const issue of all) if (issue.assignee) people.add(issue.assignee)
  for (const comment of comments) if (comment.author) people.add(comment.author)
  if (viewer) people.delete(viewer)
  const options: ComboboxOption[] = [
    { value: NO_VALUE, label: "No assignee", icon: <EmptyAvatar />, keywords: ["unassigned"] },
  ]
  if (viewer) {
    options.push({
      value: viewer,
      label: `Assign to me (${viewer})`,
      icon: <Avatar name={viewer} />,
      keywords: ["me", "myself"],
    })
  }
  for (const person of [...people].sort()) {
    options.push({ value: person, label: person, icon: <Avatar name={person} /> })
  }
  return options
}

export function labelOptions(all: Issue[], current: Issue): ComboboxOption[] {
  const names = new Set<string>([...current.labels])
  for (const issue of all) for (const label of issue.labels) names.add(label)
  const colors = labelColors(names)
  return [...colors.keys()].map((label) => ({
    value: label,
    label,
    icon: <LabelDot label={label} color={colors.get(label)} />,
  }))
}

export function issueOptions(all: Issue[], exclude: Set<string>): ComboboxOption[] {
  return all
    .filter((issue) => !exclude.has(issue.id))
    .map((issue) => ({
      value: issue.id,
      label: `#${issue.id} ${issue.title}`,
      icon: <StatusIcon status={issue.status} decorative />,
      keywords: [issue.id],
    }))
}

// issue とその子孫の番号。親に子孫を選ぶと親子が輪になるので、親の候補から外す
export function descendantIds(all: Issue[], issueId: string): Set<string> {
  const ids = new Set<string>([issueId])
  let grew = true
  while (grew) {
    grew = false
    for (const issue of all) {
      if (issue.parent && ids.has(issue.parent) && !ids.has(issue.id)) {
        ids.add(issue.id)
        grew = true
      }
    }
  }
  return ids
}
