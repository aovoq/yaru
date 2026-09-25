import { describe, expect, test } from "bun:test"
import { BLANK } from "../page"
import type { Issue } from "../store"
import { clampMenuPosition, dueDateFor, issueMenu, type MenuItem } from "./issue-menu"

const issue: Issue = {
  ...BLANK,
  id: "7",
  title: "称号を片付ける",
  status: "todo",
  priority: "high",
  assignee: "aovoq",
  labels: ["backend"],
  dueDate: "2026-10-24",
}
const all: Issue[] = [
  issue,
  { ...issue, id: "8", assignee: "codex", labels: ["client", "backend"] },
]

function find(items: MenuItem[], label: string): MenuItem {
  const item = items.find((entry) => entry.kind !== "separator" && entry.label === label)
  if (!item) throw new Error(`menu item not found: ${label}`)
  return item
}

describe("issue menu", () => {
  const menu = issueMenu(issue, all, {
    now: new Date(2026, 8, 25, 12),
    boardUrl: "http://host/p/app/",
  })

  test("status and priority submenus mark the current value and save only that field", () => {
    const status = find(menu, "Status")
    if (status.kind !== "submenu") throw new Error("status is not a submenu")
    expect(status.items.map((item) => item.kind !== "separator" && item.label)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
      "Canceled",
    ])
    const done = find(status.items, "Done")
    expect(done).toMatchObject({
      kind: "action",
      checked: false,
      action: { type: "save", input: { status: "done" } },
    })
    expect(find(status.items, "Todo")).toMatchObject({ checked: true })
    const priority = find(menu, "Priority")
    if (priority.kind !== "submenu") throw new Error("priority is not a submenu")
    expect(find(priority.items, "No priority")).toMatchObject({
      action: { type: "save", input: { priority: null } },
    })
    expect(find(priority.items, "High")).toMatchObject({ checked: true })
  })

  test("assignee offers me, unassign, and everyone already assigned somewhere", () => {
    const assignee = find(menu, "Assignee")
    if (assignee.kind !== "submenu") throw new Error("assignee is not a submenu")
    expect(find(assignee.items, "Assign to me")).toMatchObject({
      action: { type: "save", input: { assignee: "me" } },
    })
    expect(find(assignee.items, "Unassign")).toMatchObject({
      action: { type: "save", input: { assignee: null } },
    })
    expect(find(assignee.items, "aovoq")).toMatchObject({ checked: true })
    expect(find(assignee.items, "codex")).toMatchObject({
      action: { type: "save", input: { assignee: "codex" } },
    })
  })

  test("labels toggle one label while keeping the others", () => {
    const labels = find(menu, "Labels")
    if (labels.kind !== "submenu") throw new Error("labels is not a submenu")
    expect(find(labels.items, "backend")).toMatchObject({
      checked: true,
      action: { type: "save", input: { labels: [] } },
    })
    expect(find(labels.items, "client")).toMatchObject({
      checked: false,
      action: { type: "save", input: { labels: ["backend", "client"] } },
    })
  })

  test("due date shortcuts use local calendar dates", () => {
    const due = find(menu, "Due date")
    if (due.kind !== "submenu") throw new Error("due date is not a submenu")
    expect(find(due.items, "Today")).toMatchObject({
      action: { type: "save", input: { dueDate: "2026-09-25" } },
    })
    expect(find(due.items, "Tomorrow")).toMatchObject({
      action: { type: "save", input: { dueDate: "2026-09-26" } },
    })
    expect(find(due.items, "Next week")).toMatchObject({
      action: { type: "save", input: { dueDate: "2026-10-02" } },
    })
    expect(find(due.items, "Remove due date")).toMatchObject({
      action: { type: "save", input: { dueDate: null } },
    })
  })

  test("open, sub-issue, and copy actions carry what they need", () => {
    expect(find(menu, "Open issue")).toMatchObject({ action: { type: "open", issueId: "7" } })
    expect(find(menu, "Create sub-issue")).toMatchObject({
      action: { type: "createSubIssue", parentId: "7" },
    })
    expect(find(menu, "Copy ID")).toMatchObject({ action: { type: "copy", text: "#7" } })
    expect(find(menu, "Copy link")).toMatchObject({
      action: { type: "copy", text: "http://host/p/app/?id=7" },
    })
    expect(find(menu, "Copy title")).toMatchObject({
      action: { type: "copy", text: "称号を片付ける" },
    })
  })

  test("the due date helper crosses month ends", () => {
    expect(dueDateFor(new Date(2026, 9, 31, 23), 1)).toBe("2026-11-01")
  })
})

describe("menu position", () => {
  test("a menu near the right or bottom edge flips back inside the viewport", () => {
    expect(
      clampMenuPosition(
        { x: 100, y: 100 },
        { width: 200, height: 300 },
        { width: 1000, height: 800 },
      ),
    ).toEqual({
      x: 100,
      y: 100,
    })
    expect(
      clampMenuPosition(
        { x: 950, y: 700 },
        { width: 200, height: 300 },
        { width: 1000, height: 800 },
      ),
    ).toEqual({
      x: 792,
      y: 492,
    })
  })
})
