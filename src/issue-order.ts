import type { Issue, Priority } from "./store"

// 板に並べる issue の順番と、終わった issue をどこまで見せるかを決める
// 更新時刻の順に並べると、エージェントが本文を書き足すたびに行が跳ねて、人が見ている行を見失うため、
// 既定は優先度の高い順、同じ優先度なら新しい issue (id の大きい順) にする
// ブラウザでも同じ並べ方をするので、node の機能を読み込まない

export const ISSUE_SORTS = ["priority", "updated", "created", "due"] as const
export type IssueSort = (typeof ISSUE_SORTS)[number]

export const ISSUE_GROUPS = ["status", "priority", "label", "none"] as const
export type IssueGroup = (typeof ISSUE_GROUPS)[number]

export const COMPLETED_VISIBILITIES = ["hide", "recent", "all"] as const
export type CompletedVisibility = (typeof COMPLETED_VISIBILITIES)[number]

export type IssueDisplay = {
  sort: IssueSort
  group: IssueGroup
  completed: CompletedVisibility
}

export const DEFAULT_ISSUE_DISPLAY: IssueDisplay = {
  sort: "priority",
  group: "status",
  completed: "recent",
}

// recent のときに見せる、終わってからの日数
export const COMPLETED_RECENT_DAYS = 7

const DAY_MILLISECONDS = 86_400_000

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const NO_PRIORITY_RANK = 4

export function parseIssueSort(value: string | null): IssueSort {
  return parseChoice("sort", ISSUE_SORTS, DEFAULT_ISSUE_DISPLAY.sort, value)
}

export function parseIssueGroup(value: string | null): IssueGroup {
  return parseChoice("group", ISSUE_GROUPS, DEFAULT_ISSUE_DISPLAY.group, value)
}

export function parseCompletedVisibility(value: string | null): CompletedVisibility {
  return parseChoice("completed", COMPLETED_VISIBILITIES, DEFAULT_ISSUE_DISPLAY.completed, value)
}

export function sortIssues(issues: Issue[], sort: IssueSort): Issue[] {
  return issues.slice().sort((left, right) => compare(left, right, sort))
}

// 終わっていない issue は常に見せる。終わった issue は、終わった (取りやめた) 時刻で見せるかを決める
export function matchesCompletedVisibility(
  issue: Issue,
  visibility: CompletedVisibility,
  now: Date,
): boolean {
  if (issue.status !== "done" && issue.status !== "canceled") return true
  if (visibility === "all") return true
  if (visibility === "hide") return false
  // 手で done にして完了時刻が無いものは、最後に更新した時刻で決める
  const finishedAt = Date.parse(
    (issue.status === "done" ? issue.completedAt : issue.canceledAt) ?? issue.updatedAt,
  )
  if (Number.isNaN(finishedAt)) return true
  return now.getTime() - finishedAt < COMPLETED_RECENT_DAYS * DAY_MILLISECONDS
}

function compare(left: Issue, right: Issue, sort: IssueSort): number {
  if (sort === "updated") {
    return right.updatedAt.localeCompare(left.updatedAt) || compareIdDescending(left, right)
  }
  if (sort === "created") {
    return right.createdAt.localeCompare(left.createdAt) || compareIdDescending(left, right)
  }
  if (sort === "due") {
    return compareDueDate(left, right) || comparePriority(left, right)
  }
  return comparePriority(left, right)
}

function comparePriority(left: Issue, right: Issue): number {
  return priorityRank(left) - priorityRank(right) || compareIdDescending(left, right)
}

// 期日の無い issue は、期日のある issue の後ろに置く
function compareDueDate(left: Issue, right: Issue): number {
  if (left.dueDate === right.dueDate) return 0
  if (left.dueDate === null) return 1
  if (right.dueDate === null) return -1
  return left.dueDate.localeCompare(right.dueDate)
}

function priorityRank(issue: Issue): number {
  return issue.priority === null ? NO_PRIORITY_RANK : PRIORITY_RANK[issue.priority]
}

// id は文字列なので、文字として比べると 9 が 10 より後ろに来る。数として比べる
// 手で付けた数でない名前 (foo.md) は数として比べられないので、文字として比べて順番を定める
function compareIdDescending(left: Issue, right: Issue): number {
  const difference = Number(right.id) - Number(left.id)
  return Number.isNaN(difference) ? right.id.localeCompare(left.id) : difference
}

function parseChoice<Choice extends string>(
  name: string,
  choices: readonly Choice[],
  fallback: Choice,
  value: string | null,
): Choice {
  if (value === null || value === "") return fallback
  if ((choices as readonly string[]).includes(value)) return value as Choice
  throw new Error(
    `invalid ${name}: expected ${joinChoices(choices)}, actual ${JSON.stringify(value)}`,
  )
}

// store.ts の joinOr と同じ書き方。store.ts は node:fs を読み込むのでブラウザからは使えない
function joinChoices(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" or ")
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`
}
