import { expect, test } from "bun:test"
import { formatDueDate, isIssueOverdue } from "./issue-dates"

const NOW = new Date(2026, 8, 26, 12, 0, 0)

test("an open issue whose due date has passed is overdue", () => {
  expect(isIssueOverdue({ dueDate: "2026-09-25", status: "todo" }, NOW)).toBe(true)
})

test("an issue due today is not overdue", () => {
  expect(isIssueOverdue({ dueDate: "2026-09-26", status: "in_progress" }, NOW)).toBe(false)
})

test("finished issues are never overdue even when the due date has passed", () => {
  expect(isIssueOverdue({ dueDate: "2026-01-01", status: "done" }, NOW)).toBe(false)
  expect(isIssueOverdue({ dueDate: "2026-01-01", status: "canceled" }, NOW)).toBe(false)
})

test("an issue without a due date is not overdue", () => {
  expect(isIssueOverdue({ dueDate: null, status: "todo" }, NOW)).toBe(false)
})

test("a due date in the current year omits the year", () => {
  expect(formatDueDate("2026-10-20", NOW)).toBe("Oct 20")
  expect(formatDueDate("2026-01-01", NOW)).toBe("Jan 1")
})

test("a due date in another year shows the year", () => {
  expect(formatDueDate("2027-10-20", NOW)).toBe("Oct 20, 2027")
  expect(formatDueDate("2025-12-31", NOW)).toBe("Dec 31, 2025")
})

test("a due date is read as a calendar date without shifting by the time zone", () => {
  // 2026-01-01 を Date.parse で読むと UTC の 0 時になり、UTC より西の地域では前の日 (Dec 31) に見えてしまう
  expect(formatDueDate("2026-01-01", new Date(2026, 0, 1))).toBe("Jan 1")
})

test("a malformed due date is shown as it is", () => {
  expect(formatDueDate("someday", NOW)).toBe("someday")
})
