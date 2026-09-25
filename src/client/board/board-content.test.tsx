import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { BLANK } from "../../page"
import type { Issue } from "../../store"
import type { IssueGroup } from "../../issue-order"
import type { ViewMode } from "../../page"
import type { PageFilters } from "../view-model"
import { BoardContent } from "./board-content"

const NOW = new Date("2026-09-26T03:00:00.000Z")

const ISSUES: Issue[] = [
  { ...BLANK, id: "1", title: "one", status: "todo", priority: "urgent", labels: ["ui"] },
  { ...BLANK, id: "2", title: "two", status: "in_progress", priority: null, labels: [] },
]

function content(
  view: ViewMode,
  group: IssueGroup,
  filters: PageFilters = {},
  issues = ISSUES,
  totalIssueCount = issues.length,
) {
  return renderToString(
    <BoardContent
      issues={issues}
      totalIssueCount={totalIssueCount}
      filters={{ basePath: "/p/app", view, group, ...filters }}
      view={view}
      group={group}
      selectedIssueId={null}
      awaitingByIssue={{ "1": { count: 1, expired: 0, soonestAnswerBy: null } }}
      labelColors={new Map([["ui", "#123456"]])}
      now={NOW}
      onMoveIssue={async () => {}}
    />,
  )
}

test("the list grouped by priority shows a heading for each priority that has issues", () => {
  const html = content("list", "priority")
  expect(html).toContain(">Urgent<")
  expect(html).toContain(">No priority<")
  expect(html).not.toContain(">High<")
})

test("the list without grouping has no group headings", () => {
  expect(content("list", "none")).not.toContain("<h2")
})

test("rows get the awaiting badge from awaitingByIssue", () => {
  expect(content("list", "status")).toMatch(/data-id="1"[\s\S]*?data-awaiting/)
})

test("status columns offer a + for a new issue in that status and let cards be dragged", () => {
  const html = content("board", "status")
  expect(html).toContain('aria-label="New Todo issue"')
  expect(html).toContain('draggable="true"')
})

test("label columns neither offer a + nor let cards be dragged, since a drop only changes the status", () => {
  const html = content("board", "label")
  expect(html).toContain(">ui<")
  expect(html).not.toContain("New ")
  expect(html).not.toContain('draggable="true"')
})

test("on phones the board scrolls one column at a time with the column + always visible on touch screens", () => {
  const html = content("board", "status")
  expect(html).toContain("snap-x")
  expect(html).toContain("w-[85vw]")
  expect(html).toContain("sm:w-[272px]")
  expect(html).toContain("[@media(hover:none)]:opacity-100")
})

test("clearing the filters of an empty board stays in the workspace and keeps the view", () => {
  const html = content("board", "status", { awaiting: true }, [])
  expect(html).toContain("No matching issues")
  expect(html).toContain('href="/p/app/?view=board"')
})

test("when only finished issues are hidden, the empty board offers to show them instead of saying there are none", () => {
  const html = content("list", "status", { completed: "hide" }, [], 3)
  expect(html).toContain("No open issues")
  expect(html).toContain('href="/p/app/?completed=all"')
  expect(html).not.toContain("No issues yet")
})

test("an empty workspace explains how to create the first issue", () => {
  expect(content("list", "status", {}, [], 0)).toContain("No issues yet")
})
