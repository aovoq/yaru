import { expect, test } from "vitest"
import { activityEntries, describeIssueEvent } from "./activity-entries"
import type { IssueEvent } from "../domain/issue-event"
import { BLANK_ISSUE } from "./model"

function event(overrides: Partial<IssueEvent>): IssueEvent {
  return {
    field: "priority",
    from: "high",
    to: "urgent",
    by: "aovoq",
    session: null,
    at: "2026-09-26T01:00:00.000Z",
    ...overrides,
  }
}

test("a property change reads as who changed which property from what to what", () => {
  expect(describeIssueEvent(event({}))).toBe("changed priority High → Urgent")
  expect(describeIssueEvent(event({ field: "status", from: "todo", to: "in_progress" }))).toBe(
    "changed status Todo → In Progress",
  )
})

test("setting and clearing a property read differently from changing it", () => {
  expect(describeIssueEvent(event({ field: "assignee", from: null, to: "aovoq" }))).toBe(
    "set assignee to aovoq",
  )
  expect(describeIssueEvent(event({ field: "dueDate", from: "2026-10-01", to: null }))).toBe(
    "removed due date 2026-10-01",
  )
})

test("list properties name only what was added and removed", () => {
  expect(describeIssueEvent(event({ field: "labels", from: ["a", "b"], to: ["b", "c"] }))).toBe(
    "added label c, removed label a",
  )
  expect(describeIssueEvent(event({ field: "blocks", from: [], to: ["3", "4"] }))).toBe(
    "added blocks #3, #4",
  )
})

test("recorded status changes replace the lifecycle entries derived from the timestamps", () => {
  const issue = {
    ...BLANK_ISSUE,
    id: "1",
    createdAt: "2026-09-26T00:00:00.000Z",
    startedAt: "2026-09-26T01:00:00.000Z",
  }
  expect(activityEntries(issue, [], []).map((entry) => entry.kind)).toEqual([
    "lifecycle",
    "lifecycle",
  ])
  const withEvents = activityEntries(
    issue,
    [],
    [event({ field: "status", from: "todo", to: "in_progress" })],
  )
  expect(withEvents.map((entry) => entry.kind)).toEqual(["lifecycle", "change"])
})

test("entries that happen at the same moment keep distinct keys", () => {
  const entries = activityEntries({ ...BLANK_ISSUE, id: "1" }, [], [event({}), event({})])
  expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length)
})
