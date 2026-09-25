import { PRIORITIES, STATUSES, type Issue, type SaveInput } from "../store"
import { priorityLabel, statusLabel } from "./view-model"

// issue を右クリックしたときのメニューの中身。Linear の右クリックにならい、属性の変更・開く・コピーを並べる
// 描画と切り離し、何を並べ、押したら何をするかだけをここで決める
// 属性の選択肢 (propertyPicker) は、キーボードの s / p / a / l / d で開く選択の面とコマンドパレットでも同じものを使う

export type MenuAction =
  | { type: "save"; issueId: string; input: Partial<SaveInput> }
  | { type: "open"; issueId: string }
  | { type: "createSubIssue"; parentId: string }
  // notice は写したあとに出す知らせ。何を写したかを伝え、別の項目を押し間違えていないか確かめられるようにする
  | { type: "copy"; text: string; notice: string }

export type MenuIcon =
  | { kind: "status"; status: string }
  | { kind: "priority"; priority: Issue["priority"] }
  | { kind: "avatar"; name: string }
  | { kind: "label"; label: string }

export type MenuItem =
  | {
      kind: "action"
      label: string
      // 押せない項目 (「No labels yet」のような案内) には操作を持たせない
      action?: MenuAction
      disabled?: boolean
      checked?: boolean
      icon?: MenuIcon
      hint?: string
    }
  | { kind: "submenu"; label: string; items: MenuItem[]; icon?: MenuIcon }
  | { kind: "separator" }

// キーボードやメニューから選べる issue の属性
export type PropertyField = "status" | "priority" | "assignee" | "labels" | "dueDate"

// 選択の面の 1 行。value は空の文字列で「無し」(優先度なし・担当なし・期日を外す) を表す
export type PropertyChoice = { value: string; label: string; icon?: MenuIcon; keywords?: string[] }

export type PropertyPicker = {
  field: PropertyField
  label: string
  multiple: boolean
  // 候補に無い値を打って作れるか (新しいラベル、YYYY-MM-DD の期日)
  creatable: boolean
  choices: PropertyChoice[]
  // 選ばれている印を付ける値。複数の issue を選んでいるときは、全ての issue に共通する値だけ
  selected: string[]
}

const PROPERTY_LABELS: Record<PropertyField, string> = {
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  labels: "Labels",
  dueDate: "Due date",
}

export function propertyPicker(
  field: PropertyField,
  targets: Issue[],
  all: Issue[],
  now: Date,
): PropertyPicker {
  const label = PROPERTY_LABELS[field]
  if (field === "status") {
    return {
      field,
      label,
      multiple: false,
      creatable: false,
      choices: STATUSES.map((status) => ({
        value: status,
        label: statusLabel(status),
        icon: { kind: "status", status },
        keywords: [status],
      })),
      selected: shared(targets.map((issue) => issue.status)),
    }
  }
  if (field === "priority") {
    return {
      field,
      label,
      multiple: false,
      creatable: false,
      choices: [
        { value: "", label: "No priority", icon: { kind: "priority", priority: null } },
        ...PRIORITIES.map((priority) => ({
          value: priority,
          label: priorityLabel(priority),
          icon: { kind: "priority", priority } as MenuIcon,
        })),
      ],
      selected: shared(targets.map((issue) => issue.priority ?? "")),
    }
  }
  if (field === "assignee") {
    const people = distinct(all.map((row) => row.assignee).filter((name) => name !== null))
    return {
      field,
      label,
      multiple: false,
      creatable: false,
      choices: [
        { value: "me", label: "Assign to me" },
        { value: "", label: "Unassign", keywords: ["none", "nobody"] },
        ...people.map((name) => ({
          value: name,
          label: name,
          icon: { kind: "avatar", name } as MenuIcon,
        })),
      ],
      selected: shared(targets.map((issue) => issue.assignee ?? "")),
    }
  }
  if (field === "labels") {
    const labels = distinct(all.flatMap((row) => row.labels))
    return {
      field,
      label,
      multiple: true,
      creatable: true,
      choices: labels.map((name) => ({
        value: name,
        label: name,
        icon: { kind: "label", label: name } as MenuIcon,
      })),
      selected: labels.filter(
        (name) => targets.length > 0 && targets.every((issue) => issue.labels.includes(name)),
      ),
    }
  }
  const hasDueDate = targets.some((issue) => issue.dueDate !== null)
  return {
    field,
    label,
    multiple: false,
    creatable: true,
    choices: [
      { value: dueDateFor(now, 0), label: "Today" },
      { value: dueDateFor(now, 1), label: "Tomorrow" },
      { value: dueDateFor(now, 7), label: "Next week" },
      ...(hasDueDate ? [{ value: "", label: "Remove due date" }] : []),
    ],
    selected: [],
  }
}

// 選んだ値を、その issue の保存の入力にする
// ラベルは付け外しで、選んだ全ての issue が持っていれば全てから外し、そうでなければ持っていない issue にだけ足す
export function propertyInput(
  field: PropertyField,
  value: string,
  target: Issue,
  targets: Issue[],
): Partial<SaveInput> {
  if (field === "labels") {
    const everyHas = targets.every((issue) => issue.labels.includes(value))
    if (everyHas) return { labels: target.labels.filter((label) => label !== value) }
    return {
      labels: target.labels.includes(value) ? target.labels : [...target.labels, value],
    }
  }
  if (field === "status") return { status: value }
  if (field === "priority") return { priority: (value || null) as Issue["priority"] }
  if (field === "assignee") return { assignee: value || null }
  return { dueDate: value || null }
}

export function issueMenu(
  issue: Issue,
  all: Issue[],
  options: { now: Date; boardUrl: string },
): MenuItem[] {
  const link = new URL(options.boardUrl)
  link.searchParams.set("id", issue.id)
  const submenu = (field: PropertyField, icon?: MenuIcon): MenuItem => {
    const picker = propertyPicker(field, [issue], all, options.now)
    const items = picker.choices.map((choice): MenuItem => ({
      kind: "action",
      label: choice.label,
      icon: choice.icon,
      // 期日は今日・明日などの近道なので、選ばれている印を付けない
      checked: field === "dueDate" ? undefined : picker.selected.includes(choice.value),
      action: {
        type: "save",
        issueId: issue.id,
        input: propertyInput(field, choice.value, issue, [issue]),
      },
    }))
    return { kind: "submenu", label: picker.label, icon, items: withSeparators(field, items) }
  }
  const markdownLink = `[#${issue.id} ${issue.title}](${link.href})`
  return [
    submenu("status", { kind: "status", status: issue.status }),
    submenu("priority", { kind: "priority", priority: issue.priority }),
    submenu("assignee", issue.assignee ? { kind: "avatar", name: issue.assignee } : undefined),
    submenu("labels"),
    submenu("dueDate"),
    { kind: "separator" },
    { kind: "action", label: "Open issue", hint: "↵", action: { type: "open", issueId: issue.id } },
    {
      kind: "action",
      label: "Create sub-issue",
      action: { type: "createSubIssue", parentId: issue.id },
    },
    { kind: "separator" },
    {
      kind: "action",
      label: "Copy ID",
      action: { type: "copy", text: `#${issue.id}`, notice: `Copied ID #${issue.id}` },
    },
    {
      kind: "action",
      label: "Copy link",
      action: { type: "copy", text: link.href, notice: `Copied link to #${issue.id}` },
    },
    {
      kind: "action",
      label: "Copy title",
      action: { type: "copy", text: issue.title, notice: `Copied title of #${issue.id}` },
    },
    {
      kind: "action",
      label: "Copy as Markdown",
      action: {
        type: "copy",
        text: issue.body.trim() ? `${markdownLink}\n\n${issue.body.trim()}` : markdownLink,
        notice: `Copied #${issue.id} as Markdown`,
      },
    },
  ]
}

// 担当者は「自分」「外す」と人の名前の間に、期日は近道と「外す」の間に区切りを入れる。ラベルが 1 つも無ければ案内だけを出す
function withSeparators(field: PropertyField, items: MenuItem[]): MenuItem[] {
  if (field === "labels" && items.length === 0) {
    return [{ kind: "action", label: "No labels yet", disabled: true }]
  }
  const splitAt = field === "assignee" ? 2 : field === "dueDate" ? 3 : -1
  if (splitAt < 0 || items.length <= splitAt) return items
  return [...items.slice(0, splitAt), { kind: "separator" }, ...items.slice(splitAt)]
}

// 全ての issue で同じ値なら、その値だけを返す
function shared(values: string[]): string[] {
  const unique = [...new Set(values)]
  return unique.length === 1 ? unique : []
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
