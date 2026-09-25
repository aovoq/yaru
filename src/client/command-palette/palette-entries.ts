import type { AwaitingSummary } from "../../page"
import type { Issue } from "../../store"
import { issueMenu, type MenuAction, type MenuIcon, type MenuItem } from "../issue-menu"

// ⌘K のコマンドパレットに並べる候補を決める。描画と切り離し、何を並べ、選んだら何をするかだけをここで決める
// issue を題名と番号で探す・答えを待っている質問へ飛ぶ・ワークスペースを切り替える・選んでいる issue の操作 (右クリックと同じもの) を 1 つの欄から引けるようにする
// 操作は右クリックのメニュー (issue-menu.ts) の定義をそのまま使い、同じ操作が場所によって違う結果にならないようにする

export type PaletteCommand =
  // 同じ板の中の URL へ、ページを読み直さずに移る
  | { type: "navigate"; href: string }
  // 別の画面 (dashboard・inbox・別のワークスペース) へ、ページごと移る
  | { type: "location"; href: string }
  | { type: "menu"; action: MenuAction }
  | { type: "createIssue" }

export type PaletteGroup = "Actions" | "Issues" | "Awaiting answers" | "Go to" | "Workspaces"

export type PaletteEntry = {
  // 一覧の中で候補を見分ける id。aria-activedescendant と key に使う
  key: string
  group: PaletteGroup
  label: string
  // 右に薄く添える補足 (issue の番号、待っている質問の数など)
  detail?: string
  icon?: MenuIcon
  command: PaletteCommand
}

export type PaletteWorkspace = { slug: string; basePath: string; awaiting: number }

export type PaletteInput = {
  query: string
  all: Issue[]
  awaitingByIssue: Record<string, AwaitingSummary>
  // /api/inbox から読んだワークスペースの一覧。読めていなければ空
  workspaces: PaletteWorkspace[]
  basePath: string
  // 操作の対象の issue (開いている issue か、板で選んでいる issue)
  target: Issue | null
  // issue を開く URL を作る。今の絞り込みを保ったまま開くため、呼ぶ側の pageHref を渡す
  issueHref: (issueId: string) => string
  boardUrl: string
  now: Date
}

// 何も打っていないときに出す issue の数と、打ったときに出す issue の数の上限
const RECENT_ISSUES = 5
const MATCHED_ISSUES = 8

// 並びの順は、選んでいる issue の操作 → issue → 待っている質問 → 移動 → ワークスペース
// 何も打っていないときは、操作と最近更新した issue を先に出し、すぐ Enter で使えるようにする
export function paletteEntries(input: PaletteInput): PaletteEntry[] {
  const needle = input.query.trim().toLowerCase()
  const matches = (entry: PaletteEntry) =>
    !needle || `${entry.label} ${entry.detail ?? ""}`.toLowerCase().includes(needle)
  const actions = input.target ? targetActions(input.target, input).filter(matches) : []
  // 操作は多いので、何も打っていないときは開く・作る・写すなどの短い操作だけにし、属性の変更は打ったときに出す
  const visibleActions = needle ? actions : actions.filter((entry) => !entry.label.includes(": "))
  const goTo = goToEntries(input).filter(matches)
  const workspaces = input.workspaces
    .filter((workspace) => workspace.basePath !== input.basePath)
    .map((workspace): PaletteEntry => ({
      key: `workspace-${workspace.slug}`,
      group: "Workspaces",
      label: `Switch to ${workspace.slug}`,
      detail: workspace.awaiting > 0 ? `${workspace.awaiting} awaiting` : undefined,
      command: { type: "location", href: `${workspace.basePath}/` },
    }))
    .filter(matches)
  return [
    ...visibleActions,
    ...issueEntries(input, needle),
    ...awaitingEntries(input).filter(matches),
    ...goTo,
    ...workspaces,
  ]
}

function issueEntries(input: PaletteInput, needle: string): PaletteEntry[] {
  const toEntry = (issue: Issue): PaletteEntry => ({
    key: `issue-${issue.id}`,
    group: "Issues",
    label: issue.title || "Untitled",
    detail: `#${issue.id}`,
    icon: { kind: "status", status: issue.status },
    command: { type: "navigate", href: input.issueHref(issue.id) },
  })
  if (!needle) {
    return [...input.all]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, RECENT_ISSUES)
      .map(toEntry)
  }
  // 「#73」や「73」と打ったら、その番号の issue を先頭に出す。題名に数字を含む issue より先に来るようにする
  // 先頭の # は番号の印なので、題名はそれを除いた言葉で探す
  const idQuery = needle.replace(/^#/, "")
  const exact = input.all.filter((issue) => issue.id.toLowerCase() === idQuery)
  const others = input.all.filter(
    (issue) =>
      !exact.includes(issue) &&
      (issue.title.toLowerCase().includes(idQuery) || issue.id.toLowerCase().startsWith(idQuery)),
  )
  return [...exact, ...others].slice(0, MATCHED_ISSUES).map(toEntry)
}

// 答えを待っている質問のある issue。期限を過ぎたもの (エージェントが既定の動きで進んだもの) より、まだ間に合うものを先に出す
function awaitingEntries(input: PaletteInput): PaletteEntry[] {
  const byId = new Map(input.all.map((issue) => [issue.id, issue]))
  return Object.entries(input.awaitingByIssue)
    .map(([issueId, summary]) => ({ issue: byId.get(issueId), summary }))
    .filter((row): row is { issue: Issue; summary: AwaitingSummary } => row.issue !== undefined)
    .sort((left, right) => {
      const leftOpen = left.summary.count - left.summary.expired
      const rightOpen = right.summary.count - right.summary.expired
      if (leftOpen > 0 !== rightOpen > 0) return leftOpen > 0 ? -1 : 1
      return (left.summary.soonestAnswerBy ?? "~").localeCompare(
        right.summary.soonestAnswerBy ?? "~",
      )
    })
    .map(({ issue, summary }): PaletteEntry => ({
      key: `awaiting-${issue.id}`,
      group: "Awaiting answers",
      label: `Answer ${summary.count === 1 ? "question" : `${summary.count} questions`} on ${issue.title || "Untitled"}`,
      detail: `#${issue.id}`,
      command: { type: "navigate", href: input.issueHref(issue.id) },
    }))
}

function goToEntries(input: PaletteInput): PaletteEntry[] {
  const entries: PaletteEntry[] = [
    { key: "go-create", group: "Go to", label: "Create issue", command: { type: "createIssue" } },
    {
      key: "go-dashboard",
      group: "Go to",
      label: "Open dashboard",
      command: { type: "location", href: `${input.basePath}/dashboard` },
    },
  ]
  // 全てのワークスペースの質問をまとめた /inbox は、複数のワークスペースを配っているときだけある
  if (input.workspaces.length > 0) {
    entries.push({
      key: "go-inbox",
      group: "Go to",
      label: "Open inbox",
      command: { type: "location", href: "/inbox" },
    })
  }
  return entries
}

// 右クリックのメニューを 1 列に開く。子メニューの項目は「Status: Done」のように親の名前を添える
function targetActions(target: Issue, input: PaletteInput): PaletteEntry[] {
  const entries: PaletteEntry[] = []
  const add = (item: MenuItem, parent?: string) => {
    if (item.kind === "separator") return
    if (item.kind === "submenu") {
      for (const child of item.items) add(child, item.label)
      return
    }
    if (item.disabled || !item.action) return
    // 今の値を選び直しても何も変わらないので出さない
    if (item.checked === true && item.action.type === "save" && parent !== "Labels") return
    entries.push({
      key: `action-${parent ?? ""}-${item.label}`,
      group: "Actions",
      label: parent ? `${parent}: ${item.label}` : item.label,
      detail: `#${target.id}`,
      icon: item.icon,
      command: { type: "menu", action: item.action },
    })
  }
  for (const item of issueMenu(target, input.all, { now: input.now, boardUrl: input.boardUrl })) {
    add(item)
  }
  return entries
}
