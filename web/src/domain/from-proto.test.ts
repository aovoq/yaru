import { expect, test } from "vitest"
import {
  IssuePriority,
  IssueStatus,
  QuestionStatus,
  type Comment as ProtoComment,
  type Issue as ProtoIssue,
  type IssueEvent as ProtoIssueEvent,
  type Question as ProtoQuestion,
  type RepositoryCommit as ProtoCommit,
} from "../gen/yaru/v1/common_pb"
import {
  commentFromProto,
  commitFromProto,
  eventFromProto,
  issueFromProto,
  questionFromProto,
  questionStatusToProto,
} from "./from-proto"

// 板・issue・Dashboard・受信箱は、proto の返事をここだけで画面の形に直す

const protoIssue = (overrides: Partial<ProtoIssue> = {}) =>
  ({
    id: "7",
    title: "topic",
    status: IssueStatus.IN_PROGRESS,
    labels: ["api"],
    blocks: [],
    blockedBy: ["2"],
    children: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-02T00:00:00.000Z",
    stale: false,
    body: "body",
    ...overrides,
  }) as unknown as ProtoIssue

const protoQuestion = (overrides: Partial<ProtoQuestion> = {}) =>
  ({
    id: "3",
    title: "ship?",
    status: QuestionStatus.OPEN,
    options: ["yes", "no"],
    author: "aovoq",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    body: "",
    ...overrides,
  }) as unknown as ProtoQuestion

test("a proto issue becomes the screen issue and an omitted assignee is null", () => {
  const issue = issueFromProto(protoIssue())
  expect(issue.status).toBe("in_progress")
  expect(issue.assignee).toBeNull()
  expect(issue.priority).toBeNull()
  expect(issue.blockedBy).toEqual(["2"])
})

test("an unspecified priority is null and a set priority is its name", () => {
  expect(issueFromProto(protoIssue({ priority: IssuePriority.UNSPECIFIED })).priority).toBeNull()
  expect(issueFromProto(protoIssue({ priority: IssuePriority.HIGH })).priority).toBe("high")
})

test("an issue status the screen does not know is refused", () => {
  expect(() => issueFromProto(protoIssue({ status: IssueStatus.UNSPECIFIED }))).toThrow(
    "invalid issue status: expected backlog, todo, in_progress, done, or canceled, actual 0",
  )
  expect(() => issueFromProto(protoIssue({ status: 99 as IssueStatus }))).toThrow(
    "invalid issue status: expected backlog, todo, in_progress, done, or canceled, actual 99",
  )
})

test("an unknown priority is refused", () => {
  expect(() => issueFromProto(protoIssue({ priority: 99 as IssuePriority }))).toThrow(
    "invalid priority: expected urgent, high, medium, or low, actual 99",
  )
})

test("a proto question becomes the screen question", () => {
  const question = questionFromProto(protoQuestion({ priority: IssuePriority.LOW }))
  expect(question.status).toBe("open")
  expect(question.priority).toBe("low")
  expect(question.options).toEqual(["yes", "no"])
  expect(question.answer).toBeNull()
})

test("a question status the screen does not know is refused", () => {
  expect(() => questionFromProto(protoQuestion({ status: QuestionStatus.UNSPECIFIED }))).toThrow(
    "invalid question status: expected open, expired, answered, or canceled, actual 0",
  )
})

test("an event list and text become the activity values", () => {
  const event = eventFromProto({
    field: "labels",
    fromValue: { case: "fromList", value: { values: ["a"] } },
    toValue: { case: "toText", value: "b" },
    by: "aovoq",
    at: "2020-01-01T00:00:00.000Z",
  } as unknown as ProtoIssueEvent)
  expect(event.from).toEqual(["a"])
  expect(event.to).toBe("b")
  expect(event.session).toBeNull()
})

test("a comment without a parent and a commit without a push state keep null", () => {
  const comment = commentFromProto({
    id: "1",
    issue: "7",
    author: "aovoq",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    body: "hi",
  } as unknown as ProtoComment)
  expect(comment.parent).toBeNull()
  const commit = commitFromProto({
    hash: "abc",
    subject: "fix",
    author: "aovoq",
    committedAt: "2020-01-01T00:00:00.000Z",
  } as unknown as ProtoCommit)
  expect(commit.pushed).toBeNull()
})

test("a question status name maps to the proto enum and an unknown name to undefined", () => {
  expect(questionStatusToProto("answered")).toBe(QuestionStatus.ANSWERED)
  expect(questionStatusToProto("later")).toBeUndefined()
})
