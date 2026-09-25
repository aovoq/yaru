import { PRIORITIES, STATUSES, type Issue, type SaveInput } from "../store"
import { priorityLabel, statusLabel } from "./view-model"

// issue を右クリックしたときのメニューの中身。Linear の右クリックにならい、属性の変更・開く・コピーを並べる
// 描画と切り離し、何を並べ、押したら何をするかだけをここで決める

export type MenuAction =
  | { type: "save"; issueId: string; input: Partial<SaveInput> }
  | { type: "open"; issueId: string }
  | { type: "createSubIssue"; parentId: string }
  | { type: "copy"; text: string }

export type MenuIcon =
  | { kind: "status"; status: string }
  | { kind: "priority"; priority: Issue["priority"] }
  | { kind: "avatar"; name: string }
  | { kind: "label"; label: string }

export type MenuItem =
  | {
      kind: "action"
      label: string
      action: MenuAction
      checked?: boolean
      icon?: MenuIcon
      hint?: string
    }
  | { kind: "submenu"; label: string; items: MenuItem[]; icon?: MenuIcon }
  | { kind: "separator" }

export function issueMenu(
  issue: Issue,
  all: Issue[],
  options: { now: Date; boardUrl: string },
): MenuItem[] {
  const save = (input: Partial<SaveInput>): MenuAction => ({
    type: "save",
    issueId: issue.id,
    input,
  })
  const people = distinct(all.map((row) => row.assignee).filter((name) => name !== null))
  const labels = distinct(all.flatMap((row) => row.labels))
  const link = new URL(options.boardUrl)
  link.searchParams.set("id", issue.id)
  return [
    {
      kind: "submenu",
      label: "Status",
      icon: { kind: "status", status: issue.status },
      items: STATUSES.map((status) => ({
        kind: "action",
        label: statusLabel(status),
        icon: { kind: "status", status },
        checked: issue.status === status,
        action: save({ status }),
      })),
    },
    {
      kind: "submenu",
      label: "Priority",
      icon: { kind: "priority", priority: issue.priority },
      items: [
        {
          kind: "action",
          label: "No priority",
          icon: { kind: "priority", priority: null },
          checked: issue.priority === null,
          action: save({ priority: null }),
        },
        ...PRIORITIES.map((priority): MenuItem => ({
          kind: "action",
          label: priorityLabel(priority),
          icon: { kind: "priority", priority },
          checked: issue.priority === priority,
          action: save({ priority }),
        })),
      ],
    },
    {
      kind: "submenu",
      label: "Assignee",
      icon: issue.assignee ? { kind: "avatar", name: issue.assignee } : undefined,
      items: [
        { kind: "action", label: "Assign to me", action: save({ assignee: "me" }) },
        {
          kind: "action",
          label: "Unassign",
          checked: issue.assignee === null,
          action: save({ assignee: null }),
        },
        ...(people.length > 0 ? [{ kind: "separator" } as MenuItem] : []),
        ...people.map((name): MenuItem => ({
          kind: "action",
          label: name,
          icon: { kind: "avatar", name },
          checked: issue.assignee === name,
          action: save({ assignee: name }),
        })),
      ],
    },
    {
      kind: "submenu",
      label: "Labels",
      items:
        labels.length === 0
          ? [
              {
                kind: "action",
                label: "No labels yet",
                action: { type: "open", issueId: issue.id },
              },
            ]
          : labels.map((label) => {
              const has = issue.labels.includes(label)
              return {
                kind: "action",
                label,
                icon: { kind: "label", label },
                checked: has,
                action: save({
                  labels: has
                    ? issue.labels.filter((other) => other !== label)
                    : [...issue.labels, label],
                }),
              }
            }),
    },
    {
      kind: "submenu",
      label: "Due date",
      items: [
        { kind: "action", label: "Today", action: save({ dueDate: dueDateFor(options.now, 0) }) },
        {
          kind: "action",
          label: "Tomorrow",
          action: save({ dueDate: dueDateFor(options.now, 1) }),
        },
        {
          kind: "action",
          label: "Next week",
          action: save({ dueDate: dueDateFor(options.now, 7) }),
        },
        ...(issue.dueDate
          ? [
              { kind: "separator" } as MenuItem,
              {
                kind: "action",
                label: "Remove due date",
                action: save({ dueDate: null }),
              } as MenuItem,
            ]
          : []),
      ],
    },
    { kind: "separator" },
    { kind: "action", label: "Open issue", hint: "↵", action: { type: "open", issueId: issue.id } },
    {
      kind: "action",
      label: "Create sub-issue",
      action: { type: "createSubIssue", parentId: issue.id },
    },
    { kind: "separator" },
    { kind: "action", label: "Copy ID", action: { type: "copy", text: `#${issue.id}` } },
    { kind: "action", label: "Copy link", action: { type: "copy", text: link.href } },
    { kind: "action", label: "Copy title", action: { type: "copy", text: issue.title } },
  ]
}

// 期日は人の暦の日付なので、UTC ではなく端末の地域の日付で数える
export function dueDateFor(now: Date, days: number): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

const VIEWPORT_MARGIN = 8

// 画面の右端や下端ではみ出すときは、はみ出さない位置まで戻す
export function clampMenuPosition(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(point.x, viewport.width - size.width - VIEWPORT_MARGIN)),
    y: Math.max(
      VIEWPORT_MARGIN,
      Math.min(point.y, viewport.height - size.height - VIEWPORT_MARGIN),
    ),
  }
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}
