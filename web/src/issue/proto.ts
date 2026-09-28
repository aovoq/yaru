import {
  CompletedVisibility,
  IssueGroup,
  IssuePriority,
  IssueSort,
  IssueStatus,
  IssueView,
  QuestionStatus,
  type Comment as ProtoComment,
  type Issue as ProtoIssue,
  type IssueEvent as ProtoIssueEvent,
  type Question as ProtoQuestion,
  type RepositoryCommit as ProtoCommit,
} from "../gen/yaru/v1/common_pb"
import type { BoardQuery } from "../route"
import { SaveRejectedError } from "./save-error"
import type { Issue, Priority } from "../domain/issue"
import type { Question, QuestionStatus as QuestionStatusName } from "../domain/question"
import {
  DEFAULT_COMPLETED,
  DEFAULT_GROUP,
  DEFAULT_SORT,
  DEFAULT_VIEW,
} from "./filters"
import type { Comment, Commit, IssueEvent, IssueEventValue, IssuePage, SaveInput } from "./model"

// proto の enum と、今の画面が使っている文字列の対応。未知の絞り込みは送らない (RPC は InvalidArgument にする)

const ISO_8601_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const STATUS_TO_NAME: Record<number, string> = {
  [IssueStatus.BACKLOG]: "backlog",
  [IssueStatus.TODO]: "todo",
  [IssueStatus.IN_PROGRESS]: "in_progress",
  [IssueStatus.DONE]: "done",
  [IssueStatus.CANCELED]: "canceled",
}

const NAME_TO_STATUS: Record<string, IssueStatus> = {
  backlog: IssueStatus.BACKLOG,
  todo: IssueStatus.TODO,
  in_progress: IssueStatus.IN_PROGRESS,
  done: IssueStatus.DONE,
  canceled: IssueStatus.CANCELED,
}

const PRIORITY_TO_NAME: Record<number, Priority> = {
  [IssuePriority.URGENT]: "urgent",
  [IssuePriority.HIGH]: "high",
  [IssuePriority.MEDIUM]: "medium",
  [IssuePriority.LOW]: "low",
}

const NAME_TO_PRIORITY: Record<string, IssuePriority> = {
  urgent: IssuePriority.URGENT,
  high: IssuePriority.HIGH,
  medium: IssuePriority.MEDIUM,
  low: IssuePriority.LOW,
}

const QUESTION_TO_NAME: Record<number, QuestionStatusName> = {
  [QuestionStatus.OPEN]: "open",
  [QuestionStatus.EXPIRED]: "expired",
  [QuestionStatus.ANSWERED]: "answered",
  [QuestionStatus.CANCELED]: "canceled",
}

const NAME_TO_QUESTION: Record<string, QuestionStatus> = {
  open: QuestionStatus.OPEN,
  expired: QuestionStatus.EXPIRED,
  answered: QuestionStatus.ANSWERED,
  canceled: QuestionStatus.CANCELED,
}

const SORT_TO_NAME: Record<number, string> = {
  [IssueSort.PRIORITY]: "priority",
  [IssueSort.UPDATED]: "updated",
  [IssueSort.CREATED]: "created",
  [IssueSort.DUE]: "due",
}

const GROUP_TO_NAME: Record<number, string> = {
  [IssueGroup.STATUS]: "status",
  [IssueGroup.PRIORITY]: "priority",
  [IssueGroup.LABEL]: "label",
  [IssueGroup.NONE]: "none",
}

const COMPLETED_TO_NAME: Record<number, string> = {
  [CompletedVisibility.HIDE]: "hide",
  [CompletedVisibility.RECENT]: "recent",
  [CompletedVisibility.ALL]: "all",
}

const VIEW_TO_NAME: Record<number, string> = {
  [IssueView.LIST]: "list",
  [IssueView.BOARD]: "board",
}

export type PageResponse = {
  issues: ProtoIssue[]
  all: ProtoIssue[]
  query: string
  current?: ProtoIssue
  comments: ProtoComment[]
  questions: ProtoQuestion[]
  events: ProtoIssueEvent[]
  commits: ProtoCommit[]
  status?: IssueStatus
  assignee?: string
  label?: string
  awaiting: boolean
  display?: { sort: IssueSort; group: IssueGroup; completed: CompletedVisibility }
  view: IssueView
  basePath: string
  viewer: string
  error?: string
  now: string
}

// 返事の now を時刻の基準にする。ブラウザの現在時刻には落とさない
export function serverNow(value: string): Date {
  const parsed = Date.parse(value)
  if (!ISO_8601_DATETIME.test(value) || Number.isNaN(parsed)) {
    throw new Error(
      `invalid now: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual ${JSON.stringify(value)}`,
    )
  }
  return new Date(parsed)
}

export function pageFromResponse(response: PageResponse): IssuePage {
  return {
    issues: response.issues.map(issueFromProto),
    all: response.all.map(issueFromProto),
    query: response.query,
    current: response.current ? issueFromProto(response.current) : null,
    comments: response.comments.map(commentFromProto),
    questions: response.questions.flatMap(questionFromProto),
    events: response.events.map(eventFromProto),
    commits: response.commits.map(commitFromProto),
    status: optionalName(response.status, STATUS_TO_NAME),
    assignee: response.assignee,
    label: response.label,
    awaiting: response.awaiting,
    display: {
      sort: named(response.display?.sort, SORT_TO_NAME, DEFAULT_SORT),
      group: named(response.display?.group, GROUP_TO_NAME, DEFAULT_GROUP),
      completed: named(response.display?.completed, COMPLETED_TO_NAME, DEFAULT_COMPLETED),
    },
    view: named(response.view, VIEW_TO_NAME, DEFAULT_VIEW),
    basePath: response.basePath,
    viewer: response.viewer,
    error: response.error,
    now: response.now,
  }
}

export function issueFromProto(issue: ProtoIssue): Issue {
  return {
    id: issue.id,
    title: issue.title,
    status: STATUS_TO_NAME[issue.status] ?? "todo",
    assignee: issue.assignee ?? null,
    labels: issue.labels,
    dueDate: issue.dueDate ?? null,
    priority: issue.priority === undefined ? null : (PRIORITY_TO_NAME[issue.priority] ?? null),
    parent: issue.parent ?? null,
    blocks: issue.blocks,
    blockedBy: issue.blockedBy,
    children: issue.children,
    startedAt: issue.startedAt ?? null,
    completedAt: issue.completedAt ?? null,
    canceledAt: issue.canceledAt ?? null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    session: issue.session ?? null,
    worktree: issue.worktree ?? null,
    branch: issue.branch ?? null,
    stale: issue.stale,
    body: issue.body,
  }
}

export function commentFromProto(comment: ProtoComment): Comment {
  return {
    id: comment.id,
    issue: comment.issue,
    parent: comment.parent ?? null,
    author: comment.author,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    body: comment.body,
  }
}

export function questionFromProto(question: ProtoQuestion): Question[] {
  const status = QUESTION_TO_NAME[question.status]
  if (!status) return []
  return [
    {
      id: question.id,
      title: question.title,
      status,
      issue: question.issue ?? null,
      priority:
        question.priority === undefined ? null : (PRIORITY_TO_NAME[question.priority] ?? null),
      defaultAction: question.defaultAction ?? null,
      answerBy: question.answerBy ?? null,
      options: question.options,
      author: question.author,
      session: question.session ?? null,
      worktree: question.worktree ?? null,
      branch: question.branch ?? null,
      answer: question.answer ?? null,
      answeredBy: question.answeredBy ?? null,
      answeredAt: question.answeredAt ?? null,
      acknowledgedAt: question.acknowledgedAt ?? null,
      notifiedExpiringAt: question.notifiedExpiringAt ?? null,
      canceledAt: question.canceledAt ?? null,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      body: question.body,
    },
  ]
}

export function eventFromProto(event: ProtoIssueEvent): IssueEvent {
  return {
    field: event.field,
    from: eventValue(event.fromValue),
    to: eventValue(event.toValue),
    by: event.by,
    session: event.session ?? null,
    at: event.at,
  }
}

export function commitFromProto(commit: ProtoCommit): Commit {
  return {
    hash: commit.hash,
    subject: commit.subject,
    author: commit.author,
    committedAt: commit.committedAt,
    pushed: commit.pushed ?? null,
  }
}

function eventValue(
  value: ProtoIssueEvent["fromValue"] | ProtoIssueEvent["toValue"],
): IssueEventValue {
  if (value.case === "fromText" || value.case === "toText") return value.value
  if (value.case === "fromList" || value.case === "toList") return value.value.values
  return null
}

// 未設定の enum は既定の名前にする。0 は「指定なし」なので、絞り込みとしては送らない側の既定と同じ
function named(value: number | undefined, names: Record<number, string>, fallback: string): string {
  if (value === undefined) return fallback
  return names[value] ?? fallback
}

function optionalName(value: number | undefined, names: Record<number, string>): string | undefined {
  if (value === undefined) return undefined
  return names[value]
}

export type GetPageInit = {
  workspace: string
  query?: string
  id?: string
  status?: IssueStatus
  assignee?: string
  label?: string
  awaiting?: boolean
  sort?: IssueSort
  group?: IssueGroup
  completed?: CompletedVisibility
  view?: IssueView
  newStatus?: IssueStatus
  newParent?: string
  newLabel?: string
  newAssignee?: string
  error?: string
}

export function getPageInit(workspace: string, issueId: string, query: BoardQuery): GetPageInit {
  const request: GetPageInit = { workspace, id: issueId }
  if (query.query) request.query = query.query
  const status = NAME_TO_STATUS[query.status ?? ""]
  if (status !== undefined) request.status = status
  if (query.assignee) request.assignee = query.assignee
  if (query.label) request.label = query.label
  if (query.awaiting === "1") request.awaiting = true
  const sort = sortEnum(query.sort)
  if (sort !== undefined) request.sort = sort
  const group = groupEnum(query.group)
  if (group !== undefined) request.group = group
  const completed = completedEnum(query.completed)
  if (completed !== undefined) request.completed = completed
  const view = viewEnum(query.view)
  if (view !== undefined) request.view = view
  const newStatus = NAME_TO_STATUS[query.newStatus ?? ""]
  if (newStatus !== undefined) request.newStatus = newStatus
  if (query.newParent) request.newParent = query.newParent
  if (query.newLabel) request.newLabel = query.newLabel
  if (query.newAssignee) request.newAssignee = query.newAssignee
  if (query.error) request.error = query.error
  return request
}

function sortEnum(value: string | null): IssueSort | undefined {
  if (value === "priority") return IssueSort.PRIORITY
  if (value === "updated") return IssueSort.UPDATED
  if (value === "created") return IssueSort.CREATED
  if (value === "due") return IssueSort.DUE
  return undefined
}

function groupEnum(value: string | null): IssueGroup | undefined {
  if (value === "status") return IssueGroup.STATUS
  if (value === "priority") return IssueGroup.PRIORITY
  if (value === "label") return IssueGroup.LABEL
  if (value === "none") return IssueGroup.NONE
  return undefined
}

function completedEnum(value: string | null): CompletedVisibility | undefined {
  if (value === "hide") return CompletedVisibility.HIDE
  if (value === "recent") return CompletedVisibility.RECENT
  if (value === "all") return CompletedVisibility.ALL
  return undefined
}

function viewEnum(value: string | null): IssueView | undefined {
  if (value === "list") return IssueView.LIST
  if (value === "board") return IssueView.BOARD
  return undefined
}

// 変えた項目だけを載せる。空文字はクリア。優先度のクリアは UNSPECIFIED。blocks と本文は oneof
export type SaveIssueInit = {
  workspace: string
  id?: string
  title?: string
  status?: IssueStatus
  assignee?: string
  labels?: { values: string[] }
  dueDate?: string
  priority?: { priority: IssuePriority }
  parent?: string
  blocksChange?: { case: "blocks"; value: { values: string[] } }
  bodyChange?: { case: "body"; value: string }
}

export function saveIssueInit(workspace: string, input: SaveInput): SaveIssueInit {
  const request: SaveIssueInit = { workspace }
  if (input.id) request.id = input.id
  if (input.title !== undefined) request.title = input.title
  if (input.status !== undefined) request.status = statusEnum(input.status)
  if (input.assignee !== undefined) request.assignee = input.assignee ?? ""
  if (input.labels !== undefined) request.labels = { values: input.labels }
  if (input.dueDate !== undefined) request.dueDate = input.dueDate ?? ""
  if (input.priority !== undefined) {
    request.priority = {
      priority: input.priority === null ? IssuePriority.UNSPECIFIED : priorityEnum(input.priority),
    }
  }
  if (input.parent !== undefined) request.parent = input.parent ?? ""
  if (input.blocks !== undefined) {
    request.blocksChange = { case: "blocks", value: { values: input.blocks } }
  }
  if (input.body !== undefined) request.bodyChange = { case: "body", value: input.body }
  return request
}

export function statusEnum(status: string): IssueStatus {
  const value = NAME_TO_STATUS[status]
  if (value === undefined) {
    throw new SaveRejectedError(
      `invalid status: expected backlog, todo, in_progress, done, or canceled, actual ${JSON.stringify(status)}`,
    )
  }
  return value
}

export function priorityEnum(priority: string): IssuePriority {
  const value = NAME_TO_PRIORITY[priority]
  if (value === undefined) {
    throw new SaveRejectedError(
      `invalid priority: expected urgent, high, medium, or low, actual ${JSON.stringify(priority)}`,
    )
  }
  return value
}

export function questionStatusEnum(status: string): QuestionStatus | undefined {
  return NAME_TO_QUESTION[status]
}
