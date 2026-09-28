import type { Comment } from "../domain/comment"
import type { Issue, Priority } from "../domain/issue"
import type { IssueEvent } from "../domain/issue-event"
import type { Question } from "../domain/question"
import type { RepositoryCommit } from "../domain/repository"

// issue 画面が読む形。proto の message は proto.ts でこの形に直す

export type DraftField =
  | "title"
  | "status"
  | "assignee"
  | "labels"
  | "dueDate"
  | "priority"
  | "parent"
  | "blocks"
  | "body"

// 自動保存の状態。画面の上に Saving… / Saved / 保存できなかったこと (failed) を出す
// failed は保存に失敗し、手元にまだ保存していない変更が残っている間だけ続く
export type SaveState = "idle" | "saving" | "saved" | "failed"

// フォームの失敗で URL に載って戻ってきた書きかけ。コメント欄と回答欄に入れ直す
export type ReturnedDrafts = {
  comment?: string
  answer?: { questionId: string; text: string }
}

// 板の URL に載せる絞り込みと見せ方。リンクはここから作り、絞り込みを切り替えても見せ方が戻らないようにする
export type PageFilters = {
  query?: string
  status?: string
  assignee?: string
  label?: string
  awaiting?: boolean
  sort?: string
  group?: string
  completed?: string
  view?: string
  basePath?: string
}

export type SaveInput = {
  id?: string
  title?: string
  status?: string
  assignee?: string | null
  labels?: string[]
  dueDate?: string | null
  priority?: Priority | null
  parent?: string | null
  blocks?: string[]
  body?: string
}

// GetPage を画面の状態にしたもの。now は返事の時刻で、ブラウザの時計ではない
export type IssuePage = {
  issues: Issue[]
  all: Issue[]
  query: string
  current: Issue | null
  comments: Comment[]
  questions: Question[]
  events: IssueEvent[]
  commits: RepositoryCommit[]
  status?: string
  assignee?: string
  label?: string
  awaiting: boolean
  display: { sort: string; group: string; completed: string }
  view: string
  basePath: string
  viewer: string
  error?: string
  now: string
}

export const BLANK_ISSUE: Issue = {
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
