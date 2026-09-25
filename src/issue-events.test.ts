import { afterEach, expect, test } from "bun:test"
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { issueEvents } from "./issue-events"
import { gitName, init, saveIssue } from "./store"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-events-"))
  dirs.push(root)
  return init(root)
}

const AGENT = { session: "session-1", worktree: "/work/feature", branch: "feature/x" }

test("a save appends one event per changed property with who, which session, and when", () => {
  const store = workspace()
  saveIssue(store, { title: "task" }, { now: new Date("2026-09-20T00:00:00.000Z") })
  expect(issueEvents(store, "1")).toEqual([])

  const at = new Date("2026-09-20T01:00:00.000Z")
  saveIssue(
    store,
    { id: "1", status: "in_progress", priority: "high", labels: ["ui", "web"], body: "text" },
    { provenance: AGENT, now: at },
  )
  const by = gitName()
  expect(issueEvents(store, "1")).toEqual([
    {
      field: "status",
      from: "todo",
      to: "in_progress",
      by,
      session: "session-1",
      at: at.toISOString(),
    },
    {
      field: "labels",
      from: [],
      to: ["ui", "web"],
      by,
      session: "session-1",
      at: at.toISOString(),
    },
    { field: "priority", from: null, to: "high", by, session: "session-1", at: at.toISOString() },
  ])

  saveIssue(store, { id: "1", status: "done" }, { now: new Date("2026-09-20T02:00:00.000Z") })
  expect(issueEvents(store, "1").map((event) => [event.field, event.to, event.session])).toEqual([
    ["status", "in_progress", "session-1"],
    ["labels", ["ui", "web"], "session-1"],
    ["priority", "high", "session-1"],
    ["status", "done", null],
  ])
})

test("a save that changes no property writes no event", () => {
  const store = workspace()
  saveIssue(store, { title: "task", status: "todo" })
  saveIssue(store, { id: "1", status: "todo", title: "task", labels: [] })
  saveIssue(store, { id: "1", body: "only the body" })
  expect(issueEvents(store, "1")).toEqual([])
  expect(existsSync(join(store.dir, "events", "1.jsonl"))).toBe(false)
})

test("title, assignee, due date, parent, and blocks are recorded", () => {
  const store = workspace()
  saveIssue(store, { title: "parent" })
  saveIssue(store, { title: "child" })
  saveIssue(store, {
    id: "2",
    title: "renamed",
    assignee: "alice",
    dueDate: "2026-10-01",
    parent: "1",
    addBlocks: ["1"],
  })
  expect(issueEvents(store, "2").map(({ field, from, to }) => ({ field, from, to }))).toEqual([
    { field: "title", from: "child", to: "renamed" },
    { field: "assignee", from: null, to: "alice" },
    { field: "dueDate", from: null, to: "2026-10-01" },
    { field: "parent", from: null, to: "1" },
    { field: "blocks", from: [], to: ["1"] },
  ])
})

test("changing blockedBy records the blocks change on the other issue", () => {
  const store = workspace()
  saveIssue(store, { title: "a" })
  saveIssue(store, { title: "b" })
  saveIssue(store, { id: "2", addBlockedBy: ["1"] }, { provenance: AGENT })
  expect(issueEvents(store, "2")).toEqual([])
  expect(
    issueEvents(store, "1").map(({ field, from, to, session }) => ({ field, from, to, session })),
  ).toEqual([{ field: "blocks", from: [], to: ["2"], session: "session-1" }])
})

test("a broken line in the event file does not hide the other events", () => {
  const store = workspace()
  saveIssue(store, { title: "task" })
  saveIssue(store, { id: "1", status: "done" })
  appendFileSync(join(store.dir, "events", "1.jsonl"), "{broken\n")
  saveIssue(store, { id: "1", status: "todo" })
  expect(issueEvents(store, "1").map((event) => event.to)).toEqual(["done", "todo"])
  expect(readFileSync(join(store.dir, "events", "1.jsonl"), "utf8").split("\n")).toHaveLength(4)
})

test("events of an issue that does not exist are rejected", () => {
  const store = workspace()
  expect(() => issueEvents(store, "9")).toThrow("issue not found: 9")
})
