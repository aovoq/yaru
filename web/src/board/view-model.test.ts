import { expect, test } from "vitest"
import { BLANK } from "./page-data"
import type { Issue } from "../domain/issue"
import { DEFAULT_ISSUE_DISPLAY } from "./display"
import {
  groupIssues,
  newIssueHref,
  pageFilters,
  pageHref,
  workspaceName,
  type PageFilters,
} from "./view-model"

function issue(id: string, fields: Partial<Issue> = {}): Issue {
  return { ...BLANK, id, title: `issue ${id}`, ...fields }
}

test("pageHref keeps the display options and the awaiting filter so moving between filters does not reset them", () => {
  const filters: PageFilters = {
    basePath: "/p/app",
    status: "todo",
    awaiting: true,
    sort: "updated",
    group: "label",
    completed: "all",
  }
  expect(pageHref(filters)).toBe(
    "/p/app/?status=todo&awaiting=1&sort=updated&group=label&completed=all",
  )
})

test("pageHref leaves the default display options out of the URL", () => {
  expect(pageHref({ ...DEFAULT_ISSUE_DISPLAY, basePath: "/p/app", awaiting: false })).toBe(
    "/p/app/",
  )
})

test("pageFilters does not carry the completed option the server forces to all for the done column", () => {
  const page = {
    query: "",
    status: "done",
    awaiting: false,
    display: { sort: "priority", group: "status", completed: "all" },
    view: "list",
    basePath: "/p/app",
  } as const
  const filters = pageFilters(page)
  expect(filters.completed).toBeUndefined()
  expect(pageHref({ ...filters, status: undefined })).toBe("/p/app/")
})

test("pageFilters keeps a completed option chosen for a column that is not finished", () => {
  const filters = pageFilters({
    query: "bug",
    status: "todo",
    assignee: "me",
    label: "ui",
    awaiting: true,
    display: { sort: "due", group: "priority", completed: "hide" },
    view: "board",
    basePath: "",
  })
  expect(filters).toEqual({
    query: "bug",
    status: "todo",
    assignee: "me",
    label: "ui",
    awaiting: true,
    sort: "due",
    group: "priority",
    completed: "hide",
    view: "board",
    basePath: "",
  })
})

test("newIssueHref carries the current label and assignee so the new issue lands in the filtered view", () => {
  expect(newIssueHref({ basePath: "/p/app", label: "ui", assignee: "me" }, "todo")).toBe(
    "/p/app/?assignee=me&label=ui&id=new&new_status=todo&new_label=ui&new_assignee=me",
  )
})

test("groupIssues by status keeps every status column in the fixed order, including empty ones", () => {
  const sections = groupIssues(
    [issue("1", { status: "done" }), issue("2", { status: "todo" }), issue("3", { status: "x" })],
    "status",
  )
  expect(sections.map((section) => [section.key, section.issues.map((row) => row.id)])).toEqual([
    ["backlog", []],
    ["todo", ["2"]],
    ["in_progress", []],
    ["done", ["1"]],
    ["canceled", []],
    ["x", ["3"]],
  ])
  expect(sections[1]).toMatchObject({ group: "status", value: "todo", title: "Todo" })
})

test("groupIssues by priority puts issues without a priority last and keeps the server order inside a group", () => {
  const sections = groupIssues(
    [
      issue("1", { priority: null }),
      issue("2", { priority: "high" }),
      issue("3", { priority: "urgent" }),
      issue("4", { priority: "high" }),
    ],
    "priority",
  )
  expect(sections.map((section) => [section.title, section.issues.map((row) => row.id)])).toEqual([
    ["Urgent", ["3"]],
    ["High", ["2", "4"]],
    ["Medium", []],
    ["Low", []],
    ["No priority", ["1"]],
  ])
})

test("groupIssues by label shows each issue once under its first label in name order, and unlabeled issues last", () => {
  const sections = groupIssues(
    [
      issue("1", { labels: ["ui", "bug"] }),
      issue("2", { labels: [] }),
      issue("3", { labels: ["ui"] }),
      issue("4", { labels: ["Zeta"] }),
    ],
    "label",
  )
  expect(sections.map((section) => [section.title, section.issues.map((row) => row.id)])).toEqual([
    ["Zeta", ["4"]],
    ["bug", ["1"]],
    ["ui", ["3"]],
    ["No label", ["2"]],
  ])
})

test("groupIssues without grouping returns one section with every issue", () => {
  const sections = groupIssues([issue("2"), issue("1")], "none")
  expect(sections).toHaveLength(1)
  expect(sections[0]!.issues.map((row) => row.id)).toEqual(["2", "1"])
})

test("workspaceName reads the slug from the base path and falls back to yaru for a single workspace", () => {
  expect(workspaceName("/p/yaru-demo")).toBe("yaru-demo")
  expect(workspaceName("")).toBe("yaru")
  expect(workspaceName(undefined)).toBe("yaru")
})
