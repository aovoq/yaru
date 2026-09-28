import { Code, ConnectError } from "@connectrpc/connect"
import { expect, test } from "vitest"
import {
  CompletedVisibility,
  IssueGroup,
  IssuePriority,
  IssueSort,
  IssueStatus,
  IssueView,
  type Issue as ProtoIssue,
} from "../gen/yaru/v1/common_pb"
import type { GetPageResponse } from "../gen/yaru/v1/page_pb"
import { SaveRejectedError } from "./save-error"
import {
  errorFromSave,
  issueFromProto,
  pageFromResponse,
  pageRequestFromHref,
  saveIssueRequest,
} from "./proto"

test("pageRequestFromHref maps the board query onto GetPage enums", () => {
  expect(
    pageRequestFromHref(
      "app",
      "http://127.0.0.1/p/app/?query=map&id=3&status=todo&awaiting=1&sort=due&group=label&completed=all&view=board&error=missing",
    ),
  ).toMatchObject({
    workspace: "app",
    query: "map",
    id: "3",
    status: IssueStatus.TODO,
    awaiting: true,
    sort: IssueSort.DUE,
    group: IssueGroup.LABEL,
    completed: CompletedVisibility.ALL,
    view: IssueView.BOARD,
    error: "missing",
  })
})

test("an unknown view is rejected instead of being sent as the default list", () => {
  expect(() => pageRequestFromHref("app", "http://127.0.0.1/p/app/?view=grid")).toThrow(
    'invalid view: expected list or board, actual "grid"',
  )
})

test("pageFromResponse turns proto issues into the board shape and keeps now", () => {
  const page = pageFromResponse({
    issues: [rawIssue()],
    all: [rawIssue()],
    query: "",
    comments: [],
    questions: [],
    events: [],
    commits: [],
    awaiting: false,
    awaitingByIssue: { "7": { count: 1, expired: 0, soonestAnswerBy: "2026-09-29T00:00:00.000Z" } },
    display: {
      sort: IssueSort.PRIORITY,
      group: IssueGroup.STATUS,
      completed: CompletedVisibility.RECENT,
    },
    view: IssueView.LIST,
    basePath: "/p/app",
    awaitingQuestionCount: 1,
    viewer: "aovoq",
    now: "2026-09-28T12:00:00.000Z",
  } as unknown as GetPageResponse)
  expect(page.now).toBe("2026-09-28T12:00:00.000Z")
  expect(page.issues[0]).toMatchObject({
    id: "7",
    status: "todo",
    assignee: null,
    priority: "high",
    dueDate: null,
  })
  expect(page.awaitingByIssue["7"]?.soonestAnswerBy).toBe("2026-09-29T00:00:00.000Z")
  expect(page.display).toEqual({ sort: "priority", group: "status", completed: "recent" })
  expect(page.view).toBe("list")
  expect(issueFromProto(rawIssue()).labels).toEqual(["ui"])
})

test("clearing a priority sends UNSPECIFIED and a full blocks list replaces relations", () => {
  expect(saveIssueRequest("app", { id: "7", priority: null, blocks: [] })).toMatchObject({
    workspace: "app",
    id: "7",
    priority: { priority: IssuePriority.UNSPECIFIED },
    blocksChange: { case: "blocks", value: { values: [] } },
    bodyChange: { case: undefined },
  })
})

test("a value Connect rejects becomes SaveRejectedError and a dropped connection stays retryable", () => {
  const rejected = errorFromSave(
    new ConnectError("invalid dueDate: expected YYYY-MM-DD, actual x", Code.InvalidArgument),
  )
  expect(rejected).toBeInstanceOf(SaveRejectedError)
  expect(rejected.message).toBe("invalid dueDate: expected YYYY-MM-DD, actual x")
  const dropped = errorFromSave(new ConnectError("unavailable", Code.Unavailable))
  expect(dropped).not.toBeInstanceOf(SaveRejectedError)
  expect(dropped.message).toBe("unavailable")
})

function rawIssue(): ProtoIssue {
  return {
    id: "7",
    title: "地図",
    status: IssueStatus.TODO,
    labels: ["ui"],
    priority: IssuePriority.HIGH,
    blocks: [],
    blockedBy: [],
    children: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    stale: false,
    body: "",
  } as unknown as ProtoIssue
}
