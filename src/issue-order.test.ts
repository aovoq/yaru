import { expect, test } from "bun:test"
import {
  COMPLETED_RECENT_DAYS,
  matchesCompletedVisibility,
  parseCompletedVisibility,
  parseIssueGroup,
  parseIssueSort,
  sortIssues,
} from "./issue-order"
import { BLANK } from "./page"
import type { Issue } from "./store"

function issue(fields: Partial<Issue> & { id: string }): Issue {
  return { ...BLANK, title: `issue ${fields.id}`, ...fields }
}

test("priority order puts urgent first, no priority last, and newer ids first within a priority", () => {
  const issues = [
    issue({ id: "9", priority: "low" }),
    issue({ id: "10", priority: null }),
    issue({ id: "2", priority: "urgent" }),
    issue({ id: "11", priority: "low" }),
    issue({ id: "3", priority: "high" }),
    issue({ id: "4", priority: "medium" }),
    issue({ id: "12", priority: null }),
  ]
  expect(sortIssues(issues, "priority").map((row) => row.id)).toEqual([
    "2",
    "3",
    "4",
    "11",
    "9",
    "12",
    "10",
  ])
  // 並べ替えは元の配列を変えない
  expect(issues[0]!.id).toBe("9")
})

test("ids that are not numbers still get a fixed place", () => {
  const issues = [issue({ id: "alpha" }), issue({ id: "2" }), issue({ id: "beta" })]
  expect(sortIssues(issues, "priority").map((row) => row.id)).toEqual(["beta", "alpha", "2"])
})

test("updated and created order show the newest first and break ties by id numerically", () => {
  const issues = [
    issue({
      id: "9",
      updatedAt: "2026-09-20T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
    }),
    issue({
      id: "10",
      updatedAt: "2026-09-20T00:00:00.000Z",
      createdAt: "2026-09-02T00:00:00.000Z",
    }),
    issue({
      id: "1",
      updatedAt: "2026-09-21T00:00:00.000Z",
      createdAt: "2026-09-02T00:00:00.000Z",
    }),
  ]
  expect(sortIssues(issues, "updated").map((row) => row.id)).toEqual(["1", "10", "9"])
  expect(sortIssues(issues, "created").map((row) => row.id)).toEqual(["10", "1", "9"])
})

test("due order puts the nearest due date first and issues without one last", () => {
  const issues = [
    issue({ id: "1", dueDate: null, priority: "urgent" }),
    issue({ id: "2", dueDate: "2026-10-02" }),
    issue({ id: "3", dueDate: "2026-10-01", priority: "low" }),
    issue({ id: "4", dueDate: "2026-10-01", priority: "high" }),
  ]
  expect(sortIssues(issues, "due").map((row) => row.id)).toEqual(["4", "3", "2", "1"])
})

test("display options reject values the board does not know", () => {
  expect(parseIssueSort(null)).toBe("priority")
  expect(parseIssueSort("due")).toBe("due")
  expect(() => parseIssueSort("title")).toThrow(
    'invalid sort: expected priority, updated, created, or due, actual "title"',
  )
  expect(parseIssueGroup(null)).toBe("status")
  expect(parseIssueGroup("none")).toBe("none")
  expect(() => parseIssueGroup("assignee")).toThrow(
    'invalid group: expected status, priority, label, or none, actual "assignee"',
  )
  expect(parseCompletedVisibility(null)).toBe("recent")
  expect(parseCompletedVisibility("all")).toBe("all")
  expect(() => parseCompletedVisibility("old")).toThrow(
    'invalid completed: expected hide, recent, or all, actual "old"',
  )
})

test("recent shows issues finished within the last week and hide shows none of them", () => {
  const now = new Date("2026-09-26T12:00:00.000Z")
  const day = 86_400_000
  const recentlyDone = issue({
    id: "1",
    status: "done",
    completedAt: new Date(now.getTime() - (COMPLETED_RECENT_DAYS * day - 1)).toISOString(),
  })
  const longDone = issue({
    id: "2",
    status: "done",
    completedAt: new Date(now.getTime() - (COMPLETED_RECENT_DAYS * day + 1)).toISOString(),
  })
  const recentlyCanceled = issue({
    id: "3",
    status: "canceled",
    canceledAt: new Date(now.getTime() - day).toISOString(),
  })
  // 手で done にして完了時刻が無いものは、最後に更新した時刻で決める
  const handEdited = issue({
    id: "4",
    status: "done",
    completedAt: null,
    updatedAt: new Date(now.getTime() - 30 * day).toISOString(),
  })
  const open = issue({ id: "5", status: "todo", updatedAt: "2020-01-01T00:00:00.000Z" })
  const shown = (visibility: "hide" | "recent" | "all") =>
    [recentlyDone, longDone, recentlyCanceled, handEdited, open]
      .filter((row) => matchesCompletedVisibility(row, visibility, now))
      .map((row) => row.id)
  expect(shown("recent")).toEqual(["1", "3", "5"])
  expect(shown("hide")).toEqual(["5"])
  expect(shown("all")).toEqual(["1", "2", "3", "4", "5"])
})
