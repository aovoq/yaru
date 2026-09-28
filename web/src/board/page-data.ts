import type { Issue, Priority } from "../domain/issue"
import type { Question } from "../domain/question"
import {
  DEFAULT_ISSUE_DISPLAY,
  type CompletedVisibility,
  type IssueDisplay,
  type IssueGroup,
  type IssueSort,
} from "./display"

// 板 1 画面分。GetPage の返事を画面の言葉にしたもの (docs/spec/routes.md の GetPage、src/page.ts)
// now は返事の時刻。無いあいだは、まだ GetPage が返っていない

export const DEFAULT_VIEW = "list"

export type ViewMode = "board" | "list"

export type AwaitingSummary = {
  count: number
  expired: number
  soonestAnswerBy: string | null
}

export type Comment = {
  id: string
  issue: string
  parent: string | null
  author: string
  createdAt: string
  updatedAt: string
  body: string
}

export type IssueEventValue = string | string[] | null

export type IssueEvent = {
  field: string
  from: IssueEventValue
  to: IssueEventValue
  by: string
  session: string | null
  at: string
}

export type IssueCommit = {
  hash: string
  subject: string
  author: string
  committedAt: string
  pushed: boolean | null
}

export type PageData = {
  issues: Issue[]
  all: Issue[]
  query: string
  current: Issue | null
  comments: Comment[]
  questions?: Question[]
  events: IssueEvent[]
  commits: IssueCommit[]
  status?: string
  assignee?: string
  label?: string
  awaiting: boolean
  awaitingByIssue: Record<string, AwaitingSummary>
  display: IssueDisplay
  view: ViewMode
  basePath?: string
  awaitingQuestionCount?: number
  viewer: string
  error?: string
  now?: string
}

export type SaveInput = {
  id?: string
  title?: string
  status?: string
  assignee?: string | null
  labels?: string[]
  dueDate?: string | null
  priority?: string | null
  parent?: string | null
  blocks?: string[]
  addBlocks?: string[]
  removeBlocks?: string[]
  addBlockedBy?: string[]
  removeBlockedBy?: string[]
  body?: string
  patch?: unknown
}

export type InboxWorkspace = {
  slug: string
  basePath: string
  awaiting: number
}

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

export function emptyPage(basePath: string): PageData {
  return {
    issues: [],
    all: [],
    query: "",
    current: null,
    comments: [],
    questions: [],
    events: [],
    commits: [],
    awaiting: false,
    awaitingByIssue: {},
    display: { ...DEFAULT_ISSUE_DISPLAY },
    view: DEFAULT_VIEW,
    basePath,
    awaitingQuestionCount: 0,
    viewer: "",
  }
}

export function pageTitle(...parts: (string | null | undefined)[]): string {
  return [...parts.filter((part): part is string => Boolean(part)), "yaru"].join(" · ")
}

export type { CompletedVisibility, IssueDisplay, IssueGroup, IssueSort, Priority }
