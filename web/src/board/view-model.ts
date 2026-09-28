import {
  DEFAULT_ISSUE_DISPLAY,
  type CompletedVisibility,
  type IssueGroup,
  type IssueSort,
} from "./display"
import { DEFAULT_VIEW, type PageData, type ViewMode } from "./page-data"
import { PRIORITIES, STATUSES, type Issue, type Priority } from "../domain/issue"

// 板の URL に載せる絞り込みと見せ方。表示の設定 (sort・group・completed) も URL で持ち、
// 絞り込みを切り替えるリンクを押しても見せ方が戻らないよう、全てのリンクをここから作る
export type PageFilters = {
  query?: string
  status?: string
  assignee?: string
  label?: string
  // 答えを待っている質問のある issue だけに絞るか (?awaiting=1)
  awaiting?: boolean
  sort?: IssueSort
  group?: IssueGroup
  completed?: CompletedVisibility
  view?: ViewMode
  basePath?: string
}

export function pageHref(filters: PageFilters, id?: string): string {
  const parameters = new URLSearchParams()
  if (filters.query) parameters.set("query", filters.query)
  if (filters.status) parameters.set("status", filters.status)
  if (filters.assignee) parameters.set("assignee", filters.assignee)
  if (filters.label) parameters.set("label", filters.label)
  if (filters.awaiting) parameters.set("awaiting", "1")
  if (filters.sort && filters.sort !== DEFAULT_ISSUE_DISPLAY.sort) {
    parameters.set("sort", filters.sort)
  }
  if (filters.group && filters.group !== DEFAULT_ISSUE_DISPLAY.group) {
    parameters.set("group", filters.group)
  }
  if (filters.completed && filters.completed !== DEFAULT_ISSUE_DISPLAY.completed) {
    parameters.set("completed", filters.completed)
  }
  if (filters.view && filters.view !== DEFAULT_VIEW) parameters.set("view", filters.view)
  if (id) parameters.set("id", id)
  const query = parameters.toString()
  const base = filters.basePath ?? ""
  return query ? `${base}/?${query}` : `${base}/`
}

// 読み込んだ板の状態から、リンクに載せる絞り込みを作る
// 完了と取りやめの列を開いたときは、サーバーが completed を all に固定して返す (page.ts)
// それをそのまま載せると、別の列へ移ったときに人が選んでいない all が URL に残るので載せない
export function pageFilters(
  page: Pick<
    PageData,
    "query" | "status" | "assignee" | "label" | "awaiting" | "display" | "view" | "basePath"
  >,
): PageFilters {
  const finishedColumn = page.status === "done" || page.status === "canceled"
  return {
    query: page.query,
    status: page.status,
    assignee: page.assignee,
    label: page.label,
    awaiting: page.awaiting,
    sort: page.display.sort,
    group: page.display.group,
    completed: finishedColumn ? undefined : page.display.completed,
    view: page.view,
    basePath: page.basePath ?? "",
  }
}

// 新しい issue を作る画面へのリンク。いまのラベルと担当者の絞り込みを new_label・new_assignee で渡し、
// 作った issue が今見ている絞り込みから消えないようにする
export function newIssueHref(filters: PageFilters, status?: string, parent?: string): string {
  const url = new URL(pageHref(filters, "new"), "http://yaru.local")
  if (status) url.searchParams.set("new_status", status)
  if (parent) url.searchParams.set("new_parent", parent)
  if (filters.label) url.searchParams.set("new_label", filters.label)
  if (filters.assignee) url.searchParams.set("new_assignee", filters.assignee)
  return `${url.pathname}${url.search}`
}

// 新しい issue の画面の URL から、下書きの初めの値を渡すための引数 (newIssueHref が付けるもの) を落とす
// 作ったあとや閉じたあとに残すと、読み直しや戻る操作で同じ値の付いた新しい issue の画面が開き直してしまう
export function deleteNewIssueParams(url: URL): void {
  for (const name of ["new_status", "new_parent", "new_label", "new_assignee"]) {
    url.searchParams.delete(name)
  }
}

export function issueColumns(issues: Issue[]): string[] {
  const extraStatuses: string[] = []
  for (const issue of issues) {
    if (
      !(STATUSES as readonly string[]).includes(issue.status) &&
      !extraStatuses.includes(issue.status)
    ) {
      extraStatuses.push(issue.status)
    }
  }
  return [...STATUSES, ...extraStatuses]
}

// 板の列と一覧の見出しで分ける 1 つのまとまり
// value は、そのまとまりの状態・優先度・ラベルの値。優先度やラベルが無い issue のまとまりと、分けないときは null
export type IssueSection = {
  key: string
  group: IssueGroup
  value: string | null
  title: string
  issues: Issue[]
}

// issue をまとまりに分ける。まとまりの中はサーバーが並べた順 (display.sort) のまま使う
// status と priority は、空のまとまりも決まった順に全て返す。板の列が issue の有無で出たり消えたりしないようにするため (一覧は空を描かない)
// label は複数付いた issue を名前の順で最初のラベル 1 つにだけ入れる。同じ issue が 2 行あると、j / k で選ぶ順番と右クリックのメニューが食い違うため
// ラベルの順は labelColors と同じく code point で決め、並ぶ順と色の順をそろえる
export function groupIssues(issues: Issue[], group: IssueGroup): IssueSection[] {
  if (group === "status") {
    return issueColumns(issues).map((status) => ({
      key: status,
      group,
      value: status,
      title: statusLabel(status),
      issues: issues.filter((issue) => issue.status === status),
    }))
  }
  if (group === "priority") {
    const priorities: (Priority | null)[] = [...PRIORITIES, null]
    return priorities.map((priority) => ({
      key: priority ?? "none",
      group,
      value: priority,
      title: priority ? priorityLabel(priority) : "No priority",
      issues: issues.filter((issue) => issue.priority === priority),
    }))
  }
  if (group === "label") {
    const sections = new Map<string, Issue[]>()
    const unlabeled: Issue[] = []
    for (const issue of issues) {
      const first = primaryLabel(issue)
      if (first === undefined) {
        unlabeled.push(issue)
        continue
      }
      const items = sections.get(first) ?? []
      items.push(issue)
      sections.set(first, items)
    }
    const labeled: IssueSection[] = [...sections.keys()].sort(compareCodePoint).map((label) => ({
      key: `label:${label}`,
      group,
      value: label,
      title: label,
      issues: sections.get(label)!,
    }))
    return unlabeled.length > 0
      ? [
          ...labeled,
          { key: "label:none", group, value: null, title: "No label", issues: unlabeled },
        ]
      : labeled
  }
  return [{ key: "all", group, value: null, title: "All issues", issues }]
}

// issue を代表する 1 つのラベル。名前の順 (code point) で最初のものにする
// ラベルで分けた一覧のまとまりと、スマホ幅の行の 2 行目に出すラベルを同じものにそろえるため
export function primaryLabel(issue: Pick<Issue, "labels">): string | undefined {
  return [...issue.labels].sort(compareCodePoint)[0]
}

// ワークスペースの名前。/p/<名前> の接頭辞から読み、1 つだけ配っているとき (接頭辞が空) は yaru と出す
export function workspaceName(basePath: string | undefined): string {
  const match = /^\/p\/([^/]+)$/.exec(basePath ?? "")
  return match ? decodeURIComponent(match[1]!) : "yaru"
}

export function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

export function priorityLabel(priority: Priority): string {
  return priority.replace(/^\w/, (character) => character.toUpperCase())
}

// localeCompare は Bun とブラウザで照合順が違うことがあるので、code point で比べる (components/tint.ts の labelColors と同じ)
function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
