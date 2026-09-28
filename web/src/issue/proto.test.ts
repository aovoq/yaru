import { expect, test } from "vitest"
import {
  IssuePriority,
  IssueStatus,
  type Issue as ProtoIssue,
  type IssueEvent as ProtoIssueEvent,
} from "../gen/yaru/v1/common_pb"
import { getPageInit, saveIssueInit, serverNow } from "./proto"
import type { BoardQuery } from "../route"

const query = (overrides: Partial<BoardQuery> = {}): BoardQuery => ({
  query: null,
  id: null,
  status: null,
  assignee: null,
  label: null,
  awaiting: null,
  sort: null,
  group: null,
  completed: null,
  view: null,
  newStatus: null,
  newParent: null,
  newLabel: null,
  newAssignee: null,
  error: null,
  comment: null,
  questionId: null,
  answer: null,
  ...overrides,
})

test("a cleared priority and a blocks replacement use the proto oneof", () => {
  expect(saveIssueInit("demo", { id: "1", priority: null, blocks: ["2"], assignee: null })).toEqual(
    {
      workspace: "demo",
      id: "1",
      assignee: "",
      priority: { priority: IssuePriority.UNSPECIFIED },
      blocksChange: { case: "blocks", value: { values: ["2"] } },
    },
  )
})

test("the page request sends known filters and the open id, and drops an unknown sort", () => {
  expect(
    getPageInit(
      "demo",
      "4",
      query({ status: "todo", sort: "nope", awaiting: "1", newParent: "4" }),
    ),
  ).toEqual({
    workspace: "demo",
    id: "4",
    status: IssueStatus.TODO,
    awaiting: true,
    newParent: "4",
  })
})

test("the server now is the clock, and a non-ISO string is refused", () => {
  expect(serverNow("2020-01-15T00:00:00.000Z").toISOString()).toBe("2020-01-15T00:00:00.000Z")
  expect(() => serverNow("yesterday")).toThrow(/invalid now/)
})
