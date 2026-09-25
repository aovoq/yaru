import { issueEvents, type IssueEvent } from "./issue-events"
import {
  matchesCompletedVisibility,
  parseCompletedVisibility,
  parseIssueGroup,
  parseIssueSort,
  sortIssues,
  type IssueDisplay,
} from "./issue-order"
import { listQuestions, type Question } from "./questions"
import { commitsForIssue, type IssueCommit } from "./repository"
import {
  getIssue,
  gitName,
  listComments,
  listIssues,
  type Comment,
  type Issue,
  type Store,
} from "./store"

export const BLANK: Issue = {
  id: "",
  title: "",
  status: "todo",
  assignee: null,
  labels: [],
  dueDate: null,
  priority: null,
  parent: null,
  blocks: [],
  blockedBy: [],
  children: [],
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  createdAt: "",
  updatedAt: "",
  session: null,
  worktree: null,
  branch: null,
  stale: false,
  body: "",
}

export const DEFAULT_VIEW = "list"

export type ViewMode = "board" | "list"

export function parseView(raw?: string): ViewMode {
  return raw === "board" ? "board" : "list"
}

// issue ごとの、人の答えを待っている質問 (open と expired) のまとめ
export type AwaitingSummary = {
  count: number
  // そのうち期限を過ぎて、エージェントが既定の動きで進んだもの
  expired: number
  // まだ期限の来ていない質問のうち、最も早い期限。期限の付いた open の質問が無ければ null
  soonestAnswerBy: string | null
}

export type PageData = {
  // 絞り込み・終わった issue の見せ方・並べ方を当てた一覧。まとまり (group) は画面がこの順のまま分ける
  issues: Issue[]
  // 絞り込む前の全ての issue。親や blocks を選ぶ一覧に使う
  all: Issue[]
  query: string
  current: Issue | null
  comments: Comment[]
  // 開いている issue の質問。人が先に見るべき順 (questions.ts の compareQuestions) に並ぶ
  questions?: Question[]
  // 開いている issue の属性の変更履歴 (古い順)
  events: IssueEvent[]
  // 開いている issue に関わるコミット (新しい順)
  commits: IssueCommit[]
  status?: string
  assignee?: string
  label?: string
  // ?awaiting=1 で、答えを待っている質問のある issue だけに絞っているか
  awaiting: boolean
  awaitingByIssue: Record<string, AwaitingSummary>
  display: IssueDisplay
  view: ViewMode
  // 1 つの yaru serve で複数のワークスペースを配るときの、このワークスペースの URL の接頭辞 (例: /p/app)。単独なら ""
  basePath?: string
  awaitingQuestionCount?: number
  // 画面を見ている人の名前 (git config user.name)。担当者の「me」は保存のときにこの名前へ読み替わるので、画面でも同じ名前を自分として扱う
  viewer: string
  error?: string
}

export function getPageData(store: Store, url: URL, basePath = "", now = new Date()): PageData {
  const query = url.searchParams.get("query") || ""
  const id = url.searchParams.get("id") || undefined
  const status = url.searchParams.get("status") || undefined
  const assignee = url.searchParams.get("assignee") || undefined
  const label = url.searchParams.get("label") || undefined
  const awaiting = url.searchParams.get("awaiting") === "1"
  const view = parseView(url.searchParams.get("view") || undefined)
  // 完了や取りやめの列だけを開いたときに古いものが消えると、無いものと思われるので、その status を選んだときは全て見せる
  // 画面の切り替えが実際と食い違わないよう、display には当てた値を返す
  const display: IssueDisplay = {
    sort: parseIssueSort(url.searchParams.get("sort")),
    group: parseIssueGroup(url.searchParams.get("group")),
    completed:
      status === "done" || status === "canceled"
        ? "all"
        : parseCompletedVisibility(url.searchParams.get("completed")),
  }
  const awaitingQuestions = listQuestions(store, {}, now).filter(
    (question) => question.status === "open" || question.status === "expired",
  )
  const awaitingByIssue = summarizeAwaiting(awaitingQuestions)
  const issues = sortIssues(
    listIssues(store, { query: query || undefined, status, assignee, label }, now).filter(
      (issue) =>
        matchesCompletedVisibility(issue, display.completed, now) &&
        (!awaiting || awaitingByIssue[issue.id] !== undefined),
    ),
    display.sort,
  )
  const viewer = gitName()
  const opened = openIssue(store, url, id, status, viewer, now)
  const current = opened.issue
  return {
    issues,
    all: listIssues(store, {}, now),
    query,
    current,
    comments: current?.id ? listComments(store, { issue: current.id }) : [],
    questions: current?.id ? listQuestions(store, { issue: current.id }, now) : [],
    events: current?.id ? issueEvents(store, current.id) : [],
    // 手で付けた数でない名前の issue は、コミットで #<id> と書けないので探さない
    commits:
      current?.id && /^\d+$/.test(current.id)
        ? commitsForIssue(store.root, current.id, current.branch)
        : [],
    status,
    assignee,
    label,
    awaiting,
    awaitingByIssue,
    display,
    view,
    basePath,
    awaitingQuestionCount: awaitingQuestions.length,
    viewer,
    ...(opened.error !== undefined ? { error: opened.error } : {}),
  }
}

// 消えた issue へのリンク (古いブックマークや通知) を開いても、板ごと見えなくならないよう、板を出して誤りを添える
// ファイルが壊れているなどの他の誤りは、隠すと直せなくなるのでそのまま投げる
function openIssue(
  store: Store,
  url: URL,
  id: string | undefined,
  status: string | undefined,
  viewer: string,
  now: Date,
): { issue: Issue | null; error?: string } {
  if (id === undefined) return { issue: null }
  if (id === "new") {
    // ラベルや担当者で絞った板から作った issue が、作ったとたんに絞り込みから消えないよう、その値を最初から入れておく
    const label = url.searchParams.get("new_label")?.trim()
    return {
      issue: {
        ...BLANK,
        status: url.searchParams.get("new_status") || status || "todo",
        parent: url.searchParams.get("new_parent") || null,
        labels: label ? [label] : [],
        assignee: draftAssignee(url.searchParams.get("new_assignee"), viewer),
      },
    }
  }
  try {
    return { issue: getIssue(store, id, now) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === `issue not found: ${id}`) return { issue: null, error: message }
    throw err
  }
}

// 絞り込みの担当者は me (自分) と none (担当なし) を取るので、保存のとき (store.ts の resolveAssignee) と同じに読み替える
function draftAssignee(raw: string | null, viewer: string): string | null {
  const assignee = raw?.trim()
  if (!assignee || assignee === "none") return null
  if (assignee === "me") return viewer
  return assignee
}

// サーバーで描く dashboard も板と同じサイドバーを描くので export する
export function summarizeAwaiting(questions: Question[]): Record<string, AwaitingSummary> {
  const summaries: Record<string, AwaitingSummary> = {}
  for (const question of questions) {
    if (question.issue === null) continue
    const summary = (summaries[question.issue] ??= { count: 0, expired: 0, soonestAnswerBy: null })
    summary.count++
    if (question.status === "expired") {
      summary.expired++
      continue
    }
    if (
      question.answerBy !== null &&
      (summary.soonestAnswerBy === null ||
        Date.parse(question.answerBy) < Date.parse(summary.soonestAnswerBy))
    ) {
      summary.soonestAnswerBy = question.answerBy
    }
  }
  return summaries
}
