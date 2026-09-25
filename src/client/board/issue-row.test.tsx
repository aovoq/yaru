import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { BLANK } from "../../page"
import type { Issue } from "../../store"
import { IssueRow } from "./issue-row"

const NOW = new Date("2026-09-26T03:00:00.000Z")

function issue(fields: Partial<Issue> = {}): Issue {
  return { ...BLANK, id: "73", title: "板を直す", status: "todo", ...fields }
}

function row(fields: Partial<Issue> = {}, extra: Partial<Parameters<typeof IssueRow>[0]> = {}) {
  return renderToString(
    <IssueRow
      issue={issue(fields)}
      filters={{ basePath: "/p/app" }}
      selected={false}
      labelColors={new Map([["ui", "#123456"]])}
      now={NOW}
      {...extra}
    />,
  )
}

test("a list row shows the status icon and the issue number in the shared #73 form", () => {
  const html = row({ status: "in_progress" })
  expect(html).toContain('role="img" aria-label="In Progress"')
  expect(html).toContain("#73")
})

test("a selected list row marks itself with aria-selected so the primary bar and surface apply", () => {
  expect(row({}, { selected: true })).toContain('aria-selected="true"')
  expect(row()).not.toContain('aria-selected="true"')
})

test("a finished issue past its due date is not shown as overdue", () => {
  expect(row({ dueDate: "2026-09-01", status: "done" })).not.toContain("Overdue")
  expect(row({ dueDate: "2026-09-01", status: "todo" })).toContain("Overdue")
})

test("labels use the workspace colors rather than the hash of the name", () => {
  expect(row({ labels: ["ui"] })).toContain("background: #123456")
})

test("the phone layout gets a second line with the due date and the label the issue is grouped under", () => {
  const html = row({ labels: ["ui", "bug"], dueDate: "2026-10-20" })
  expect(html).toMatch(/data-row-meta[^>]*sm:hidden[\s\S]*Oct 20[\s\S]*bug/)
})

test("an issue with questions awaiting an answer shows the time left", () => {
  const html = row(
    {},
    { awaiting: { count: 1, expired: 0, soonestAnswerBy: "2026-09-26T05:00:00.000Z" } },
  )
  expect(html).toContain("data-awaiting")
  expect(html).toContain("next due in 2h")
})

test("an issue that is in progress but has not moved for a while is marked stale", () => {
  expect(row({ status: "in_progress", stale: true })).toContain("Stale")
  expect(row({ status: "in_progress", stale: false })).not.toContain("Stale")
})
