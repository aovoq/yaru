import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import type { Issue } from "../store"
import { IssueLinkList } from "./issue-link-list"

const NOW = new Date(2026, 8, 26, 12, 0, 0)

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: "1",
    title: "title",
    status: "todo",
    assignee: null,
    labels: [],
    dueDate: null,
    priority: null,
    parent: null,
    blocks: [],
    blockedBy: [],
    children: [],
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    session: null,
    worktree: null,
    branch: null,
    stale: false,
    body: "",
    ...overrides,
  }
}

function render(issues: Issue[]): string {
  return renderToString(
    <IssueLinkList issues={issues} hrefFor={(row) => `/?id=${row.id}`} showDueDate now={NOW} />,
  )
}

// 行ごとに有る物と無い物が違っても、番号・状態・期日・担当者の列が縦にそろうよう、どの行にも同じ幅の枠を置く
test("every row keeps the same slots whether or not the issue has a priority, due date or assignee", () => {
  const html = render([
    issue({ id: "1", priority: "high", dueDate: "2026-10-01", assignee: "voq" }),
    issue({ id: "20" }),
  ])
  expect(html.match(/data-slot="priority"/g)).toHaveLength(2)
  expect(html.match(/data-slot="due"/g)).toHaveLength(2)
  expect(html.match(/data-slot="assignee"/g)).toHaveLength(2)
})

test("the row shows the issue id with the shared issue id look", () => {
  expect(render([issue({ id: "73" })])).toContain(">#73<")
})

test("finished issues are dimmed and never shown as overdue", () => {
  const html = render([issue({ id: "5", status: "done", dueDate: "2026-01-01" })])
  expect(html).toContain("data-finished")
  expect(html).not.toContain("data-overdue")
})

test("an unfinished issue past its due date is shown as overdue", () => {
  expect(render([issue({ id: "5", status: "todo", dueDate: "2026-01-01" })])).toContain(
    "data-overdue",
  )
})

// 一覧は枠の中で端まで広がるので、外に出る focus の枠は切れる。内側に引いて見えるようにする
test("the focus ring is drawn inside the row", () => {
  expect(render([issue({})])).toContain("focus-visible:-outline-offset-2")
})
