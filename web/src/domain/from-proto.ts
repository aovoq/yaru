import {
  IssuePriority,
  IssueStatus,
  QuestionStatus,
  type Comment as ProtoComment,
  type IssueEvent as ProtoIssueEvent,
} from "../gen/yaru/v1/common_pb"
import type { Comment } from "./comment"
import type { Issue, Priority } from "./issue"
import type { IssueEvent, IssueEventValue } from "./issue-event"
import type { Question, QuestionStatus as QuestionStatusName } from "./question"
import type { RepositoryCommit, RepositoryState } from "./repository"
import {
  emptySessionHealth,
  type SessionHealth,
  type SessionSummary,
  type SessionTotals,
} from "./session"

// Connect の返事を、画面の部品が読む形へ写す。板・issue・Dashboard・受信箱はここだけを使う
// 未設定の optional は null。状態の数は proto の enum (docs/spec/routes.md の「列挙の名前」)
// 画面とサーバーは同じ実行ファイルから配るので、知らない enum の値は食い違いとしてエラーにする

export type QuestionLike = {
  id: string
  title: string
  status: number
  issue?: string | undefined
  priority?: number | undefined
  defaultAction?: string | undefined
  answerBy?: string | undefined
  options?: readonly string[] | undefined
  author?: string | undefined
  session?: string | undefined
  worktree?: string | undefined
  branch?: string | undefined
  answer?: string | undefined
  answeredBy?: string | undefined
  answeredAt?: string | undefined
  acknowledgedAt?: string | undefined
  notifiedExpiringAt?: string | undefined
  canceledAt?: string | undefined
  createdAt?: string | undefined
  updatedAt?: string | undefined
  body?: string | undefined
}

export type IssueLike = {
  id: string
  title: string
  status: number
  assignee?: string | undefined
  labels?: readonly string[] | undefined
  dueDate?: string | undefined
  priority?: number | undefined
  parent?: string | undefined
  blocks?: readonly string[] | undefined
  blockedBy?: readonly string[] | undefined
  children?: readonly string[] | undefined
  startedAt?: string | undefined
  completedAt?: string | undefined
  canceledAt?: string | undefined
  createdAt?: string | undefined
  updatedAt?: string | undefined
  session?: string | undefined
  worktree?: string | undefined
  branch?: string | undefined
  stale?: boolean | undefined
  body?: string | undefined
}

export type SessionSummaryLike = {
  id: string
  worktree?: string | undefined
  title?: string | undefined
  startedAt?: string | undefined
  lastActivityAt?: string | undefined
  models?: readonly string[] | undefined
  assistantMessages?: number | undefined
  inputTokens?: number | undefined
  cacheCreationTokens?: number | undefined
  cacheReadTokens?: number | undefined
  outputTokens?: number | undefined
  costUsd?: number | undefined
  unpricedMessages?: number | undefined
  toolUses?: number | undefined
  toolResults?: number | undefined
  toolErrors?: number | undefined
  interruptions?: number | undefined
  subagents?: number | undefined
}

export type SessionHealthLike = {
  directory?: string | undefined
  windowDays?: number | undefined
  sessions?: readonly SessionSummaryLike[] | undefined
  totals?:
    | {
        sessions?: number | undefined
        costUsd?: number | undefined
        unpricedMessages?: number | undefined
        assistantMessages?: number | undefined
        cacheReadRatio?: number | undefined
        toolResults?: number | undefined
        toolErrors?: number | undefined
        toolErrorRatio?: number | undefined
        interruptions?: number | undefined
      }
    | undefined
}

export type RepositoryLike = {
  branch?: string | undefined
  upstream?: string | undefined
  ahead?: number | undefined
  behind?: number | undefined
  uncommittedFiles?: number | undefined
  commits?:
    | readonly {
        hash: string
        subject: string
        author: string
        committedAt: string
        pushed?: boolean | undefined
      }[]
    | undefined
}

export function questionFromProto(message: QuestionLike): Question {
  return {
    id: message.id,
    title: message.title,
    status: questionStatusFromProto(message.status),
    issue: message.issue ?? null,
    priority: priorityFromProto(message.priority),
    defaultAction: message.defaultAction ?? null,
    answerBy: message.answerBy ?? null,
    options: [...(message.options ?? [])],
    author: message.author ?? "",
    session: message.session ?? null,
    worktree: message.worktree ?? null,
    branch: message.branch ?? null,
    answer: message.answer ?? null,
    answeredBy: message.answeredBy ?? null,
    answeredAt: message.answeredAt ?? null,
    acknowledgedAt: message.acknowledgedAt ?? null,
    notifiedExpiringAt: message.notifiedExpiringAt ?? null,
    canceledAt: message.canceledAt ?? null,
    createdAt: message.createdAt ?? "",
    updatedAt: message.updatedAt ?? "",
    body: message.body ?? "",
  }
}

export function issueFromProto(message: IssueLike): Issue {
  return {
    id: message.id,
    title: message.title,
    status: issueStatusFromProto(message.status),
    assignee: message.assignee ?? null,
    labels: [...(message.labels ?? [])],
    dueDate: message.dueDate ?? null,
    priority: priorityFromProto(message.priority),
    parent: message.parent ?? null,
    blocks: [...(message.blocks ?? [])],
    blockedBy: [...(message.blockedBy ?? [])],
    children: [...(message.children ?? [])],
    startedAt: message.startedAt ?? null,
    completedAt: message.completedAt ?? null,
    canceledAt: message.canceledAt ?? null,
    createdAt: message.createdAt ?? "",
    updatedAt: message.updatedAt ?? "",
    session: message.session ?? null,
    worktree: message.worktree ?? null,
    branch: message.branch ?? null,
    stale: message.stale ?? false,
    body: message.body ?? "",
  }
}

export function commentFromProto(message: ProtoComment): Comment {
  return {
    id: message.id,
    issue: message.issue,
    parent: message.parent ?? null,
    author: message.author,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    body: message.body,
  }
}

export function eventFromProto(message: ProtoIssueEvent): IssueEvent {
  return {
    field: message.field,
    from: eventValue(message.fromValue),
    to: eventValue(message.toValue),
    by: message.by,
    session: message.session ?? null,
    at: message.at,
  }
}

export function sessionHealthFromProto(message: SessionHealthLike | undefined): SessionHealth {
  if (message === undefined) return emptySessionHealth()
  const totals = message.totals
  const mappedTotals: SessionTotals = {
    sessions: totals?.sessions ?? 0,
    costUsd: totals?.costUsd ?? 0,
    unpricedMessages: totals?.unpricedMessages ?? 0,
    assistantMessages: totals?.assistantMessages ?? 0,
    cacheReadRatio: totals?.cacheReadRatio ?? null,
    toolResults: totals?.toolResults ?? 0,
    toolErrors: totals?.toolErrors ?? 0,
    toolErrorRatio: totals?.toolErrorRatio ?? null,
    interruptions: totals?.interruptions ?? 0,
  }
  return {
    directory: message.directory ?? null,
    windowDays: message.windowDays ?? 0,
    sessions: (message.sessions ?? []).map(sessionSummaryFromProto),
    totals: mappedTotals,
  }
}

export function repositoryFromProto(message: RepositoryLike | undefined): RepositoryState | null {
  if (message === undefined) return null
  return {
    branch: message.branch ?? null,
    upstream: message.upstream ?? null,
    ahead: message.ahead ?? null,
    behind: message.behind ?? null,
    uncommittedFiles: message.uncommittedFiles ?? 0,
    commits: (message.commits ?? []).map(commitFromProto),
  }
}

export function questionStatusToProto(status: string): QuestionStatus | undefined {
  switch (status) {
    case "open":
      return QuestionStatus.OPEN
    case "expired":
      return QuestionStatus.EXPIRED
    case "answered":
      return QuestionStatus.ANSWERED
    case "canceled":
      return QuestionStatus.CANCELED
    default:
      return undefined
  }
}

function sessionSummaryFromProto(message: SessionSummaryLike): SessionSummary {
  return {
    id: message.id,
    worktree: message.worktree ?? null,
    title: message.title ?? null,
    startedAt: message.startedAt ?? null,
    lastActivityAt: message.lastActivityAt ?? null,
    models: [...(message.models ?? [])],
    assistantMessages: message.assistantMessages ?? 0,
    inputTokens: message.inputTokens ?? 0,
    cacheCreationTokens: message.cacheCreationTokens ?? 0,
    cacheReadTokens: message.cacheReadTokens ?? 0,
    outputTokens: message.outputTokens ?? 0,
    costUsd: message.costUsd ?? 0,
    unpricedMessages: message.unpricedMessages ?? 0,
    toolUses: message.toolUses ?? 0,
    toolResults: message.toolResults ?? 0,
    toolErrors: message.toolErrors ?? 0,
    interruptions: message.interruptions ?? 0,
    subagents: message.subagents ?? 0,
  }
}

export function commitFromProto(message: {
  hash: string
  subject: string
  author: string
  committedAt: string
  pushed?: boolean | undefined
}): RepositoryCommit {
  return {
    hash: message.hash,
    subject: message.subject,
    author: message.author,
    committedAt: message.committedAt,
    pushed: message.pushed ?? null,
  }
}

function eventValue(
  value: ProtoIssueEvent["fromValue"] | ProtoIssueEvent["toValue"],
): IssueEventValue {
  if (value.case === "fromText" || value.case === "toText") return value.value
  if (value.case === "fromList" || value.case === "toList") return value.value.values
  return null
}

function questionStatusFromProto(status: number): QuestionStatusName {
  switch (status) {
    case QuestionStatus.OPEN:
      return "open"
    case QuestionStatus.EXPIRED:
      return "expired"
    case QuestionStatus.ANSWERED:
      return "answered"
    case QuestionStatus.CANCELED:
      return "canceled"
    default:
      throw new Error(
        `invalid question status: expected open, expired, answered, or canceled, actual ${status}`,
      )
  }
}

function issueStatusFromProto(status: number): string {
  switch (status) {
    case IssueStatus.BACKLOG:
      return "backlog"
    case IssueStatus.TODO:
      return "todo"
    case IssueStatus.IN_PROGRESS:
      return "in_progress"
    case IssueStatus.DONE:
      return "done"
    case IssueStatus.CANCELED:
      return "canceled"
    default:
      throw new Error(
        `invalid issue status: expected backlog, todo, in_progress, done, or canceled, actual ${status}`,
      )
  }
}

// 0 (UNSPECIFIED) と未設定は「優先度なし」
function priorityFromProto(priority: number | undefined): Priority | null {
  switch (priority) {
    case undefined:
    case IssuePriority.UNSPECIFIED:
      return null
    case IssuePriority.URGENT:
      return "urgent"
    case IssuePriority.HIGH:
      return "high"
    case IssuePriority.MEDIUM:
      return "medium"
    case IssuePriority.LOW:
      return "low"
    default:
      throw new Error(`invalid priority: expected urgent, high, medium, or low, actual ${priority}`)
  }
}
