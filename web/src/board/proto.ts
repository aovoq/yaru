import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import type { Issue as DomainIssue, Priority } from "../domain/issue"
import type { Question, QuestionStatus } from "../domain/question"
import { shouldRetryConnectError } from "../connect/client"
import {
  CompletedVisibility,
  IssueGroup,
  IssuePriority,
  IssueSort,
  IssueStatus,
  IssueView,
  PatchOpKind,
  QuestionStatus as ProtoQuestionStatus,
  BlockDeltaSchema,
  IssuePriorityUpdateSchema,
  PatchListSchema,
  PatchOperationSchema,
  StringListSchema,
  type PatchList,
  type Comment as ProtoComment,
  type Issue as ProtoIssue,
  type IssueEvent as ProtoIssueEvent,
  type Question as ProtoQuestion,
  type RepositoryCommit as ProtoCommit,
} from "../gen/yaru/v1/common_pb"
import type { GetPageResponse } from "../gen/yaru/v1/page_pb"
import { GetPageRequestSchema } from "../gen/yaru/v1/page_pb"
import type { SaveIssueResponse } from "../gen/yaru/v1/issue_pb"
import { SaveIssueRequestSchema } from "../gen/yaru/v1/issue_pb"
import { serverNow } from "./clock"
import {
  DEFAULT_ISSUE_DISPLAY,
  type CompletedVisibility as CompletedName,
  type IssueGroup as GroupName,
  type IssueSort as SortName,
} from "./display"
import type {
  AwaitingSummary,
  Comment,
  IssueCommit,
  IssueEvent,
  PageData,
  SaveInput,
  ViewMode,
} from "./page-data"
import { SaveRejectedError } from "./save-error"

// 画面の文字列と proto の enum を対応させる (docs/spec/routes.md の「列挙の名前」)
// 列挙に無い文字列は RPC が InvalidArgument にする。enum では送れないので、送る前に同じ結果になる誤りにする

const STATUS_NAMES = ["backlog", "todo", "in_progress", "done", "canceled"] as const
const PRIORITY_NAMES = ["urgent", "high", "medium", "low"] as const
const SORT_NAMES = ["priority", "updated", "created", "due"] as const
const GROUP_NAMES = ["status", "priority", "label", "none"] as const
const COMPLETED_NAMES = ["hide", "recent", "all"] as const
const VIEW_NAMES = ["list", "board"] as const
const QUESTION_NAMES = ["open", "expired", "answered", "canceled"] as const

const STATUS_ENUM: Record<(typeof STATUS_NAMES)[number], IssueStatus> = {
  backlog: IssueStatus.BACKLOG,
  todo: IssueStatus.TODO,
  in_progress: IssueStatus.IN_PROGRESS,
  done: IssueStatus.DONE,
  canceled: IssueStatus.CANCELED,
}

const PRIORITY_ENUM: Record<(typeof PRIORITY_NAMES)[number], IssuePriority> = {
  urgent: IssuePriority.URGENT,
  high: IssuePriority.HIGH,
  medium: IssuePriority.MEDIUM,
  low: IssuePriority.LOW,
}

const SORT_ENUM: Record<(typeof SORT_NAMES)[number], IssueSort> = {
  priority: IssueSort.PRIORITY,
  updated: IssueSort.UPDATED,
  created: IssueSort.CREATED,
  due: IssueSort.DUE,
}

const GROUP_ENUM: Record<(typeof GROUP_NAMES)[number], IssueGroup> = {
  status: IssueGroup.STATUS,
  priority: IssueGroup.PRIORITY,
  label: IssueGroup.LABEL,
  none: IssueGroup.NONE,
}

const COMPLETED_ENUM: Record<(typeof COMPLETED_NAMES)[number], CompletedVisibility> = {
  hide: CompletedVisibility.HIDE,
  recent: CompletedVisibility.RECENT,
  all: CompletedVisibility.ALL,
}

const VIEW_ENUM: Record<(typeof VIEW_NAMES)[number], IssueView> = {
  list: IssueView.LIST,
  board: IssueView.BOARD,
}

const QUESTION_ENUM: Record<(typeof QUESTION_NAMES)[number], QuestionStatus> = {
  open: "open",
  expired: "expired",
  answered: "answered",
  canceled: "canceled",
}

export function pageRequestFromHref(workspace: string, href: string) {
  const parameters = new URL(href, "http://127.0.0.1").searchParams
  const request: Parameters<typeof create<typeof GetPageRequestSchema>>[1] = { workspace }
  const query = parameters.get("query")
  if (query) request.query = query
  const id = parameters.get("id")
  if (id) request.id = id
  const status = optionalChoice("status", STATUS_NAMES, parameters.get("status"))
  if (status) request.status = STATUS_ENUM[status]
  const assignee = parameters.get("assignee")
  if (assignee) request.assignee = assignee
  const label = parameters.get("label")
  if (label) request.label = label
  if (parameters.get("awaiting") === "1") request.awaiting = true
  const sort = optionalChoice("sort", SORT_NAMES, parameters.get("sort"))
  if (sort) request.sort = SORT_ENUM[sort]
  const group = optionalChoice("group", GROUP_NAMES, parameters.get("group"))
  if (group) request.group = GROUP_ENUM[group]
  const completed = optionalChoice("completed", COMPLETED_NAMES, parameters.get("completed"))
  if (completed) request.completed = COMPLETED_ENUM[completed]
  const view = optionalChoice("view", VIEW_NAMES, parameters.get("view"))
  if (view) request.view = VIEW_ENUM[view]
  const newStatus = optionalChoice("new_status", STATUS_NAMES, parameters.get("new_status"))
  if (newStatus) request.newStatus = STATUS_ENUM[newStatus]
  const newParent = parameters.get("new_parent")
  if (newParent) request.newParent = newParent
  const newLabel = parameters.get("new_label")
  if (newLabel) request.newLabel = newLabel
  const newAssignee = parameters.get("new_assignee")
  if (newAssignee) request.newAssignee = newAssignee
  const error = parameters.get("error")
  if (error !== null) request.error = error
  return create(GetPageRequestSchema, request)
}

export function pageFromResponse(response: GetPageResponse): PageData {
  serverNow(response.now)
  const awaitingByIssue: Record<string, AwaitingSummary> = {}
  for (const [issueId, summary] of Object.entries(response.awaitingByIssue)) {
    awaitingByIssue[issueId] = {
      count: summary.count,
      expired: summary.expired,
      soonestAnswerBy: summary.soonestAnswerBy ?? null,
    }
  }
  return {
    issues: response.issues.map(issueFromProto),
    all: response.all.map(issueFromProto),
    query: response.query,
    current: response.current ? issueFromProto(response.current) : null,
    comments: response.comments.map(commentFromProto),
    questions: response.questions.map(questionFromProto),
    events: response.events.map(eventFromProto),
    commits: response.commits.map(commitFromProto),
    status: statusFilterName(response.status),
    assignee: response.assignee,
    label: response.label,
    awaiting: response.awaiting,
    awaitingByIssue,
    display: displayFromProto(response.display),
    view: viewName(response.view),
    basePath: response.basePath,
    awaitingQuestionCount: response.awaitingQuestionCount,
    viewer: response.viewer,
    ...(response.error !== undefined ? { error: response.error } : {}),
    now: response.now,
  }
}

export function issueFromProto(message: ProtoIssue): DomainIssue {
  return {
    id: message.id,
    title: message.title,
    status: statusName(message.status),
    assignee: message.assignee ?? null,
    labels: message.labels,
    dueDate: message.dueDate ?? null,
    priority: priorityName(message.priority),
    parent: message.parent ?? null,
    blocks: message.blocks,
    blockedBy: message.blockedBy,
    children: message.children,
    startedAt: message.startedAt ?? null,
    completedAt: message.completedAt ?? null,
    canceledAt: message.canceledAt ?? null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    session: message.session ?? null,
    worktree: message.worktree ?? null,
    branch: message.branch ?? null,
    stale: message.stale,
    body: message.body,
  }
}

export function issueFromSave(response: SaveIssueResponse): DomainIssue {
  if (!response.issue) {
    throw new Error("save issue response missing issue: expected an issue, actual none")
  }
  return issueFromProto(response.issue)
}

export function saveIssueRequest(workspace: string, input: Partial<SaveInput>) {
  const replacesBlocks = input.blocks !== undefined
  const changesBlocks =
    input.addBlocks !== undefined ||
    input.removeBlocks !== undefined ||
    input.addBlockedBy !== undefined ||
    input.removeBlockedBy !== undefined
  if (replacesBlocks && changesBlocks) {
    throw new SaveRejectedError("invalid blocks: expected either blocks or block delta, actual both")
  }
  if (input.body !== undefined && input.patch !== undefined) {
    throw new SaveRejectedError("invalid body: expected either body or patch, actual both")
  }
  return create(SaveIssueRequestSchema, {
    workspace,
    id: input.id,
    title: input.title,
    status:
      input.status === undefined
        ? undefined
        : STATUS_ENUM[requiredChoice("status", STATUS_NAMES, input.status)],
    assignee: input.assignee === undefined ? undefined : (input.assignee ?? ""),
    labels:
      input.labels === undefined ? undefined : create(StringListSchema, { values: input.labels }),
    dueDate: input.dueDate === undefined ? undefined : (input.dueDate ?? ""),
    priority:
      input.priority === undefined
        ? undefined
        : create(IssuePriorityUpdateSchema, {
            priority:
              input.priority === null || input.priority === "" || input.priority === "none"
                ? IssuePriority.UNSPECIFIED
                : PRIORITY_ENUM[requiredChoice("priority", PRIORITY_NAMES, input.priority)],
          }),
    parent: input.parent === undefined ? undefined : (input.parent ?? ""),
    blocksChange: replacesBlocks
      ? { case: "blocks", value: create(StringListSchema, { values: input.blocks ?? [] }) }
      : changesBlocks
        ? {
            case: "blockDelta",
            value: create(BlockDeltaSchema, {
              addBlocks: stringList(input.addBlocks),
              removeBlocks: stringList(input.removeBlocks),
              addBlockedBy: stringList(input.addBlockedBy),
              removeBlockedBy: stringList(input.removeBlockedBy),
            }),
          }
        : { case: undefined },
    bodyChange:
      input.body !== undefined
        ? { case: "body", value: input.body }
        : input.patch !== undefined
          ? { case: "patch", value: patchList(input.patch) }
          : { case: undefined },
  })
}

export function errorFromSave(error: unknown): Error {
  if (error instanceof SaveRejectedError) return error
  if (error instanceof ConnectError) {
    const message = error.rawMessage || error.message
    if (shouldRetryConnectError(error) || error.code === Code.Canceled) return new Error(message)
    return new SaveRejectedError(message)
  }
  if (error instanceof Error) return error
  return new Error(`request failed: expected an Error, actual ${String(error)}`)
}

export function errorFromLoad(error: unknown): Error {
  if (error instanceof ConnectError) return new Error(error.rawMessage || error.message)
  if (error instanceof Error) return error
  return new Error(`request failed: expected an Error, actual ${String(error)}`)
}

function commentFromProto(message: ProtoComment): Comment {
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

function questionFromProto(message: ProtoQuestion): Question {
  return {
    id: message.id,
    title: message.title,
    status: questionStatusName(message.status),
    issue: message.issue ?? null,
    priority: priorityName(message.priority),
    defaultAction: message.defaultAction ?? null,
    answerBy: message.answerBy ?? null,
    options: message.options,
    author: message.author,
    session: message.session ?? null,
    worktree: message.worktree ?? null,
    branch: message.branch ?? null,
    answer: message.answer ?? null,
    answeredBy: message.answeredBy ?? null,
    answeredAt: message.answeredAt ?? null,
    acknowledgedAt: message.acknowledgedAt ?? null,
    notifiedExpiringAt: message.notifiedExpiringAt ?? null,
    canceledAt: message.canceledAt ?? null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    body: message.body,
  }
}

function eventFromProto(message: ProtoIssueEvent): IssueEvent {
  return {
    field: message.field,
    from: eventValue(message.fromValue),
    to: eventValue(message.toValue),
    by: message.by,
    session: message.session ?? null,
    at: message.at,
  }
}

function eventValue(
  value: ProtoIssueEvent["fromValue"] | ProtoIssueEvent["toValue"],
): IssueEvent["from"] {
  if (value.case === "fromText" || value.case === "toText") return value.value
  if (value.case === "fromList" || value.case === "toList") return value.value.values
  return null
}

function commitFromProto(message: ProtoCommit): IssueCommit {
  return {
    hash: message.hash,
    subject: message.subject,
    author: message.author,
    committedAt: message.committedAt,
    pushed: message.pushed ?? null,
  }
}

function statusName(status: IssueStatus): string {
  const name = STATUS_NAMES.find((candidate) => STATUS_ENUM[candidate] === status)
  if (!name) {
    throw new Error(
      `invalid issue status: expected ${joinChoices(STATUS_NAMES)}, actual ${statusNameOrNumber(status)}`,
    )
  }
  return name
}

function statusFilterName(status: IssueStatus | undefined): string | undefined {
  if (status === undefined || status === IssueStatus.UNSPECIFIED) return undefined
  return statusName(status)
}

function priorityName(priority: IssuePriority | undefined): Priority | null {
  if (priority === undefined || priority === IssuePriority.UNSPECIFIED) return null
  const name = PRIORITY_NAMES.find((candidate) => PRIORITY_ENUM[candidate] === priority)
  if (!name) {
    throw new Error(
      `invalid priority: expected ${joinChoices(PRIORITY_NAMES)}, actual ${statusNameOrNumber(priority)}`,
    )
  }
  return name
}

function questionStatusName(status: ProtoQuestionStatus): QuestionStatus {
  const name = QUESTION_NAMES.find((candidate) => protoQuestionStatus(candidate) === status)
  if (!name) {
    throw new Error(
      `invalid question status: expected ${joinChoices(QUESTION_NAMES)}, actual ${statusNameOrNumber(status)}`,
    )
  }
  return QUESTION_ENUM[name]
}

function protoQuestionStatus(name: (typeof QUESTION_NAMES)[number]): ProtoQuestionStatus {
  if (name === "open") return ProtoQuestionStatus.OPEN
  if (name === "expired") return ProtoQuestionStatus.EXPIRED
  if (name === "answered") return ProtoQuestionStatus.ANSWERED
  return ProtoQuestionStatus.CANCELED
}

function displayFromProto(display: GetPageResponse["display"]): PageData["display"] {
  if (!display) return { ...DEFAULT_ISSUE_DISPLAY }
  return {
    sort: namedSort(display.sort),
    group: namedGroup(display.group),
    completed: namedCompleted(display.completed),
  }
}

function namedSort(sort: IssueSort): SortName {
  if (sort === IssueSort.UNSPECIFIED) return DEFAULT_ISSUE_DISPLAY.sort
  const name = SORT_NAMES.find((candidate) => SORT_ENUM[candidate] === sort)
  if (!name) {
    throw new Error(`invalid sort: expected ${joinChoices(SORT_NAMES)}, actual ${statusNameOrNumber(sort)}`)
  }
  return name
}

function namedGroup(group: IssueGroup): GroupName {
  if (group === IssueGroup.UNSPECIFIED) return DEFAULT_ISSUE_DISPLAY.group
  const name = GROUP_NAMES.find((candidate) => GROUP_ENUM[candidate] === group)
  if (!name) {
    throw new Error(
      `invalid group: expected ${joinChoices(GROUP_NAMES)}, actual ${statusNameOrNumber(group)}`,
    )
  }
  return name
}

function namedCompleted(completed: CompletedVisibility): CompletedName {
  if (completed === CompletedVisibility.UNSPECIFIED) return DEFAULT_ISSUE_DISPLAY.completed
  const name = COMPLETED_NAMES.find((candidate) => COMPLETED_ENUM[candidate] === completed)
  if (!name) {
    throw new Error(
      `invalid completed: expected ${joinChoices(COMPLETED_NAMES)}, actual ${statusNameOrNumber(completed)}`,
    )
  }
  return name
}

function viewName(view: IssueView): ViewMode {
  if (view === IssueView.UNSPECIFIED || view === IssueView.LIST) return "list"
  if (view === IssueView.BOARD) return "board"
  throw new Error(`invalid view: expected ${joinChoices(VIEW_NAMES)}, actual ${statusNameOrNumber(view)}`)
}

function optionalChoice<Choice extends string>(
  name: string,
  choices: readonly Choice[],
  value: string | null,
): Choice | undefined {
  if (value === null || value === "") return undefined
  return requiredChoice(name, choices, value)
}

function requiredChoice<Choice extends string>(
  name: string,
  choices: readonly Choice[],
  value: string,
): Choice {
  if ((choices as readonly string[]).includes(value)) return value as Choice
  throw new SaveRejectedError(`invalid ${name}: expected ${joinChoices(choices)}, actual ${JSON.stringify(value)}`)
}

function stringList(values: string[] | undefined) {
  if (values === undefined) return undefined
  return create(StringListSchema, { values })
}

function patchList(patch: unknown): PatchList {
  if (!Array.isArray(patch)) {
    throw new SaveRejectedError(
      `invalid patch: expected an array of operations, actual ${JSON.stringify(patch)}`,
    )
  }
  return create(PatchListSchema, {
    operations: patch.map((operation, index) => {
      if (typeof operation !== "object" || operation === null || !("op" in operation)) {
        throw new SaveRejectedError(
          `invalid patch: expected an operation at ${index}, actual ${JSON.stringify(operation)}`,
        )
      }
      const record = operation as Record<string, unknown>
      return create(PatchOperationSchema, {
        kind: patchKind(record.op, index),
        oldString: optionalString(record.old_string),
        newString: optionalString(record.new_string),
        replaceAll: typeof record.replace_all === "boolean" ? record.replace_all : undefined,
        anchor: optionalString(record.anchor),
        text: optionalString(record.text),
        from: optionalString(record.from),
        to: optionalString(record.to),
      })
    }),
  })
}

function patchKind(value: unknown, index: number): PatchOpKind {
  const kinds: Record<string, PatchOpKind> = {
    replace: PatchOpKind.REPLACE,
    insert_before: PatchOpKind.INSERT_BEFORE,
    insert_after: PatchOpKind.INSERT_AFTER,
    prepend: PatchOpKind.PREPEND,
    append: PatchOpKind.APPEND,
    replace_range: PatchOpKind.REPLACE_RANGE,
  }
  if (typeof value === "string" && kinds[value] !== undefined) return kinds[value]
  throw new SaveRejectedError(
    `invalid patch: expected ${joinChoices(Object.keys(kinds))} at ${index}, actual ${JSON.stringify(value)}`,
  )
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function joinChoices(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" or ")
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`
}

function statusNameOrNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : JSON.stringify(value)
}
