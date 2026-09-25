import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { BLANK } from "../../page"
import type { Issue } from "../../store"
import { IssueCard } from "./issue-card"

const NOW = new Date("2026-09-26T03:00:00.000Z")

function card(fields: Partial<Issue> = {}, extra: Partial<Parameters<typeof IssueCard>[0]> = {}) {
  return renderToString(
    <IssueCard
      issue={{ ...BLANK, id: "73", title: "板を直す", ...fields }}
      filters={{}}
      selected={false}
      draggable
      showStatus={false}
      labelColors={new Map([["ui", "#123456"]])}
      now={NOW}
      onDragStart={() => {}}
      onDragEnd={() => {}}
      {...extra}
    />,
  )
}

test("a card shows the issue number, workspace label colors, and overdue only for unfinished issues", () => {
  const html = card({ labels: ["ui"], dueDate: "2026-09-01", status: "todo" })
  expect(html).toContain("#73")
  expect(html).toContain("background: #123456")
  expect(html).toContain("Overdue")
  expect(card({ dueDate: "2026-09-01", status: "canceled" })).not.toContain("Overdue")
})

test("a card carries the awaiting badge and the stale marker", () => {
  const html = card(
    { status: "in_progress", stale: true },
    { awaiting: { count: 1, expired: 1, soonestAnswerBy: null } },
  )
  expect(html).toContain("data-awaiting")
  expect(html).toContain("Stale")
})

test("a card cannot be dragged when the columns are not statuses, since a drop only changes the status", () => {
  expect(card()).toContain('draggable="true"')
  expect(card({}, { draggable: false })).toContain('draggable="false"')
})

test("a card shows its status icon when the columns are not statuses", () => {
  expect(card({ status: "done" }, { showStatus: true })).toContain('aria-label="Done"')
  expect(card({ status: "done" })).not.toContain('aria-label="Done"')
})
