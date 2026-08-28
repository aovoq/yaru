import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  findRoot,
  getComment,
  getIssue,
  init,
  listComments,
  listIssues,
  open,
  pageIssues,
  parsePatch,
  saveComment,
  saveIssue,
} from "./store"

function ymd(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const dirs: string[] = []

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-"))
  dirs.push(root)
  return init(root)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("store", () => {
  test("init, save, get, list, update", () => {
    const store = workspace()
    const created = saveIssue(store, { title: "first", body: "hello" })
    expect(created.id).toBe("1")
    expect(created.status).toBe("todo")
    expect(getIssue(store, "1").title).toBe("first")
    expect(listIssues(store)).toHaveLength(1)

    const updated = saveIssue(store, { id: "1", status: "done", assignee: "voq" })
    expect(updated.status).toBe("done")
    expect(updated.body).toBe("hello")
    expect(listIssues(store, { status: "todo" })).toHaveLength(0)
    expect(listIssues(store, { assignee: "voq" })[0]?.id).toBe("1")
  })

  test("ids increment and filters work", () => {
    const store = workspace()
    saveIssue(store, { title: "a", labels: ["cli"], status: "todo" })
    saveIssue(store, { title: "b", labels: ["web"], status: "done", body: "search me" })
    expect(listIssues(store).map((i) => i.id)).toEqual(["2", "1"])
    expect(listIssues(store, { label: "cli" })).toHaveLength(1)
    expect(listIssues(store, { query: "search" })[0]?.id).toBe("2")
  })

  test("findRoot walks up", () => {
    const store = workspace()
    const nested = join(store.root, "a", "b")
    expect(findRoot(nested)).toBe(store.root)
    expect(open(store.root).dir).toBe(store.dir)
  })

  test("roundtrip via save then get", () => {
    const store = workspace()
    saveIssue(store, { title: "x", labels: ["a", "b"], body: "line\nline", assignee: "none" })
    const got = getIssue(store, "1")
    expect(got).toMatchObject({
      id: "1",
      labels: ["a", "b"],
      body: "line\nline",
      assignee: null,
    })
  })

  test("skips corrupt files in list", () => {
    const store = workspace()
    saveIssue(store, { title: "ok" })
    writeFileSync(join(store.dir, "issues", "9.md"), "not an issue")
    expect(listIssues(store).map((i) => i.id)).toEqual(["1"])
  })

  test("filename stem is the id", () => {
    const store = workspace()
    writeFileSync(
      join(store.dir, "issues", "1.md"),
      `---
id: 99
title: mismatch
status: todo
assignee:
labels:
createdAt: t
updatedAt: t
---

body
`,
    )
    expect(getIssue(store, "1").id).toBe("1")
    saveIssue(store, { id: "1", status: "done" })
    expect(existsSync(join(store.dir, "issues", "99.md"))).toBe(false)
    expect(getIssue(store, "1").status).toBe("done")
  })

  test("save with unused id does not create", () => {
    const store = workspace()
    expect(() => saveIssue(store, { id: "7", title: "explicit" })).toThrow("issue not found: 7")
    expect(() => getIssue(store, "7")).toThrow("issue not found: 7")
  })

  test("next id follows filenames not frontmatter", () => {
    const store = workspace()
    writeFileSync(
      join(store.dir, "issues", "5.md"),
      `---
id: 1
title: five
status: todo
assignee:
labels:
createdAt: t
updatedAt: t
---

x
`,
    )
    expect(saveIssue(store, { title: "next" }).id).toBe("6")
  })

  test("dueDate persists, omits, and clears", () => {
    const store = workspace()
    const created = saveIssue(store, { title: "dated", dueDate: "2026-08-20" })
    expect(created.dueDate).toBe("2026-08-20")
    expect(getIssue(store, "1").dueDate).toBe("2026-08-20")
    expect(readFileSync(join(store.dir, "issues", "1.md"), "utf8")).toContain("dueDate: 2026-08-20")

    expect(saveIssue(store, { id: "1", status: "done" }).dueDate).toBe("2026-08-20")
    expect(saveIssue(store, { id: "1", dueDate: "" }).dueDate).toBe(null)
    saveIssue(store, { id: "1", dueDate: "2026-08-20" })
    expect(saveIssue(store, { id: "1", dueDate: "none" }).dueDate).toBe(null)
    expect(readFileSync(join(store.dir, "issues", "1.md"), "utf8")).toMatch(/^dueDate:\s*$/m)
  })

  test("missing dueDate key is none", () => {
    const store = workspace()
    writeFileSync(
      join(store.dir, "issues", "1.md"),
      `---
id: 1
title: old
status: todo
assignee:
labels:
createdAt: t
updatedAt: t
---

x
`,
    )
    expect(getIssue(store, "1").dueDate).toBe(null)
    expect(getIssue(store, "1").priority).toBe(null)
  })

  test("save rejects invalid dueDate", () => {
    const store = workspace()
    expect(() => saveIssue(store, { title: "x", dueDate: "2026-02-30" })).toThrow(
      "invalid dueDate: expected YYYY-MM-DD, actual 2026-02-30",
    )
    expect(() => saveIssue(store, { title: "x", dueDate: "2026-08-20T00:00:00Z" })).toThrow(
      "invalid dueDate: expected YYYY-MM-DD, actual 2026-08-20T00:00:00Z",
    )
    expect(() => saveIssue(store, { title: "x", dueDate: "08-20" })).toThrow(
      "invalid dueDate: expected YYYY-MM-DD, actual 08-20",
    )
  })

  test("list --due overdue is before local today only", () => {
    const store = workspace()
    saveIssue(store, { title: "past", dueDate: ymd(-1) })
    saveIssue(store, { title: "today", dueDate: ymd(0) })
    saveIssue(store, { title: "future", dueDate: ymd(1) })
    saveIssue(store, { title: "none" })
    expect(listIssues(store, { due: "overdue" }).map((i) => i.title)).toEqual(["past"])
  })

  test("priority persists, omits, and clears", () => {
    const store = workspace()
    const created = saveIssue(store, { title: "hot", priority: "urgent" })
    expect(created.priority).toBe("urgent")
    expect(getIssue(store, "1").priority).toBe("urgent")
    expect(readFileSync(join(store.dir, "issues", "1.md"), "utf8")).toContain("priority: urgent")

    expect(saveIssue(store, { id: "1", status: "done" }).priority).toBe("urgent")
    expect(saveIssue(store, { id: "1", priority: "" }).priority).toBe(null)
    saveIssue(store, { id: "1", priority: "high" })
    expect(saveIssue(store, { id: "1", priority: "none" }).priority).toBe(null)
    expect(readFileSync(join(store.dir, "issues", "1.md"), "utf8")).toMatch(/^priority:\s*$/m)
  })

  test("save rejects unknown priority", () => {
    const store = workspace()
    expect(() => saveIssue(store, { title: "x", priority: "p0" })).toThrow(
      "invalid priority: expected urgent, high, medium, or low, actual p0",
    )
    expect(() => saveIssue(store, { title: "x", priority: "0" })).toThrow(
      "invalid priority: expected urgent, high, medium, or low, actual 0",
    )
    expect(() => saveIssue(store, { title: "x", priority: "Urgent" })).toThrow(
      "invalid priority: expected urgent, high, medium, or low, actual Urgent",
    )
  })

  test("save rejects unknown status", () => {
    const store = workspace()
    expect(() => saveIssue(store, { title: "x", status: "nope" })).toThrow(
      "invalid status: expected backlog, todo, in_progress, done, or canceled, actual nope",
    )
    expect(() => saveIssue(store, { title: "x", status: "Todo" })).toThrow(
      "invalid status: expected backlog, todo, in_progress, done, or canceled, actual Todo",
    )
  })

  test("save rejects empty title on update", () => {
    const store = workspace()
    saveIssue(store, { title: "keep" })
    expect(() => saveIssue(store, { id: "1", title: "" })).toThrow(
      'invalid title: expected a non-empty string, actual ""',
    )
    expect(getIssue(store, "1").title).toBe("keep")
  })

  test("list rejects unknown status filter", () => {
    const store = workspace()
    saveIssue(store, { title: "ok" })
    expect(() => listIssues(store, { status: "nope" })).toThrow(
      "invalid status: expected backlog, todo, in_progress, done, or canceled, actual nope",
    )
  })

  test("list skips hand-edited invalid dueDate and priority", () => {
    const store = workspace()
    saveIssue(store, { title: "ok" })
    writeFileSync(
      join(store.dir, "issues", "2.md"),
      `---
id: 2
title: bad date
status: todo
assignee:
labels:
dueDate: 2026-02-30
priority:
createdAt: t
updatedAt: t
---

x
`,
    )
    writeFileSync(
      join(store.dir, "issues", "3.md"),
      `---
id: 3
title: bad priority
status: todo
assignee:
labels:
dueDate:
priority: p0
createdAt: t
updatedAt: t
---

x
`,
    )
    expect(listIssues(store).map((i) => i.id)).toEqual(["1"])
  })

  test("list skips hand-edited invalid status", () => {
    const store = workspace()
    saveIssue(store, { title: "ok" })
    writeFileSync(
      join(store.dir, "issues", "2.md"),
      `---
id: 2
title: bad status
status: nope
assignee:
labels:
dueDate:
priority:
createdAt: t
updatedAt: t
---

x
`,
    )
    expect(listIssues(store).map((i) => i.id)).toEqual(["1"])
    expect(() => getIssue(store, "2")).toThrow(
      "invalid status: expected backlog, todo, in_progress, done, or canceled, actual nope",
    )
  })

  test("patch replace unique occurrence", () => {
    const store = workspace()
    saveIssue(store, { title: "x", body: "alpha\nbeta\ngamma" })
    const updated = saveIssue(store, {
      id: "1",
      patch: [{ op: "replace", old_string: "beta", new_string: "BETA" }],
    })
    expect(updated.body).toBe("alpha\nBETA\ngamma")
    expect(getIssue(store, "1").body).toBe("alpha\nBETA\ngamma")
  })

  test("patch replace_all replaces every occurrence", () => {
    const store = workspace()
    saveIssue(store, { title: "x", body: "foo bar foo" })
    expect(
      saveIssue(store, {
        id: "1",
        patch: [{ op: "replace", old_string: "foo", new_string: "baz", replace_all: true }],
      }).body,
    ).toBe("baz bar baz")
  })

  test("patch replace requires a unique match", () => {
    const store = workspace()
    saveIssue(store, { title: "x", body: "foo bar foo" })
    expect(() =>
      saveIssue(store, {
        id: "1",
        patch: [{ op: "replace", old_string: "foo", new_string: "baz" }],
      }),
    ).toThrow(
      "patch replace: old_string must match the current body exactly once, expected 1 match, actual 2",
    )
    expect(getIssue(store, "1").body).toBe("foo bar foo")
  })

  test("patch replace fails when old_string is missing", () => {
    const store = workspace()
    saveIssue(store, { title: "x", body: "only" })
    expect(() =>
      saveIssue(store, {
        id: "1",
        patch: [{ op: "replace", old_string: "missing", new_string: "x" }],
      }),
    ).toThrow(
      "patch replace: old_string must match the current body exactly once, expected 1 match, actual 0",
    )
  })

  test("patch insert_before and insert_after", () => {
    const store = workspace()
    saveIssue(store, { title: "x", body: "middle" })
    expect(
      saveIssue(store, {
        id: "1",
        patch: [
          { op: "insert_before", anchor: "middle", text: "before\n" },
          { op: "insert_after", anchor: "middle", text: "\nafter" },
        ],
      }).body,
    ).toBe("before\nmiddle\nafter")
  })

  test("patch prepend and append", () => {
    const store = workspace()
    saveIssue(store, { title: "x", body: "core" })
    expect(
      saveIssue(store, {
        id: "1",
        patch: [
          { op: "prepend", text: "start\n" },
          { op: "append", text: "\nend" },
        ],
      }).body,
    ).toBe("start\ncore\nend")
  })

  test("patch replace_range keeps the exclusive end", () => {
    const store = workspace()
    saveIssue(store, { title: "x", body: "hello WORLD foo" })
    expect(
      saveIssue(store, {
        id: "1",
        patch: [{ op: "replace_range", from: "hello ", to: " foo", new_string: "hi" }],
      }).body,
    ).toBe("hi foo")
  })

  test("patch is atomic", () => {
    const store = workspace()
    saveIssue(store, { title: "x", body: "alpha\nbeta" })
    expect(() =>
      saveIssue(store, {
        id: "1",
        patch: [
          { op: "replace", old_string: "alpha", new_string: "ALPHA" },
          { op: "replace", old_string: "missing", new_string: "x" },
        ],
      }),
    ).toThrow(
      "patch replace: old_string must match the current body exactly once, expected 1 match, actual 0",
    )
    expect(getIssue(store, "1").body).toBe("alpha\nbeta")
  })

  test("patch cannot combine with body", () => {
    const store = workspace()
    saveIssue(store, { title: "x", body: "keep" })
    expect(() =>
      saveIssue(store, {
        id: "1",
        body: "new",
        patch: [{ op: "append", text: "!" }],
      }),
    ).toThrow("cannot pass body and patch together")
    expect(getIssue(store, "1").body).toBe("keep")
  })

  test("patch is only valid on update", () => {
    const store = workspace()
    expect(() =>
      saveIssue(store, {
        title: "x",
        patch: [{ op: "append", text: "!" }],
      }),
    ).toThrow("patch is only valid when updating an existing issue")
  })

  test("parsePatch rejects empty arrays and unknown ops", () => {
    expect(() => parsePatch([])).toThrow("invalid patch: expected 1 to 50 operations, actual 0")
    expect(() => parsePatch({ op: "replace" })).toThrow(
      "invalid patch: expected a JSON array of operations, actual object",
    )
    expect(() => parsePatch([{ op: "splice", text: "x" }])).toThrow(
      "invalid patch: expected op replace, insert_before, insert_after, prepend, append, or replace_range, actual splice",
    )
  })

  test("pageIssues slices by limit and cursor", () => {
    const store = workspace()
    saveIssue(store, { title: "a" })
    saveIssue(store, { title: "b" })
    saveIssue(store, { title: "c" })
    const all = listIssues(store)
    expect(all.map((issue) => issue.id)).toEqual(["3", "2", "1"])
    const first = pageIssues(all, { limit: 2 })
    expect(first.issues.map((issue) => issue.id)).toEqual(["3", "2"])
    expect(first.hasNextPage).toBe(true)
    expect(first.cursor).toBe("2")
    const second = pageIssues(all, { limit: 2, cursor: first.cursor })
    expect(second.issues.map((issue) => issue.id)).toEqual(["1"])
    expect(second.hasNextPage).toBe(false)
    expect(second.cursor).toBeUndefined()
  })

  test("pageIssues rejects a cursor that is not in the list", () => {
    const store = workspace()
    saveIssue(store, { title: "a" })
    expect(() => pageIssues(listIssues(store), { cursor: "99" })).toThrow(
      "cursor not found: expected an issue id from a previous list page, actual 99",
    )
  })

  test("pageIssues rejects an out of range limit", () => {
    expect(() => pageIssues([], { limit: 0 })).toThrow(
      "invalid limit: expected an integer from 1 to 250, actual 0",
    )
    expect(() => pageIssues([], { limit: 251 })).toThrow(
      "invalid limit: expected an integer from 1 to 250, actual 251",
    )
  })

  test("status timestamps set and clear with the matching state", () => {
    const store = workspace()
    const created = saveIssue(store, { title: "work" })
    expect(created.startedAt).toBeNull()
    expect(created.completedAt).toBeNull()
    expect(created.canceledAt).toBeNull()

    const started = saveIssue(store, { id: "1", status: "in_progress" })
    expect(started.startedAt).toBeTruthy()
    expect(started.completedAt).toBeNull()
    const firstStart = started.startedAt

    const done = saveIssue(store, { id: "1", status: "done" })
    expect(done.startedAt).toBe(firstStart)
    expect(done.completedAt).toBeTruthy()
    expect(done.canceledAt).toBeNull()

    const reopened = saveIssue(store, { id: "1", status: "todo" })
    expect(reopened.startedAt).toBe(firstStart)
    expect(reopened.completedAt).toBeNull()
    expect(reopened.canceledAt).toBeNull()

    const canceled = saveIssue(store, { id: "1", status: "canceled" })
    expect(canceled.canceledAt).toBeTruthy()
    expect(canceled.completedAt).toBeNull()
    expect(saveIssue(store, { id: "1", status: "todo" }).canceledAt).toBeNull()
  })

  test("creating as done sets completedAt", () => {
    const store = workspace()
    const created = saveIssue(store, { title: "already", status: "done" })
    expect(created.completedAt).toBeTruthy()
    expect(created.startedAt).toBeNull()
  })

  test("parent links children and rejects cycles", () => {
    const store = workspace()
    saveIssue(store, { title: "parent" })
    saveIssue(store, { title: "child", parent: "1" })
    expect(getIssue(store, "2").parent).toBe("1")
    expect(getIssue(store, "1").children).toEqual(["2"])
    expect(listIssues(store, { parent: "1" }).map((issue) => issue.id)).toEqual(["2"])
    expect(listIssues(store, { parent: null }).map((issue) => issue.id)).toEqual(["1"])

    expect(() => saveIssue(store, { id: "1", parent: "2" })).toThrow(
      "invalid parent: cycle: 2 is a descendant of 1",
    )
    expect(() => saveIssue(store, { id: "1", parent: "1" })).toThrow(
      "invalid parent: an issue cannot be its own parent, actual 1",
    )
    expect(() => saveIssue(store, { title: "x", parent: "9" })).toThrow(
      "invalid parent: issue not found: 9",
    )
    expect(saveIssue(store, { id: "2", parent: "none" }).parent).toBeNull()
    expect(getIssue(store, "1").children).toEqual([])
  })

  test("blocks are append-only and blockedBy is derived", () => {
    const store = workspace()
    saveIssue(store, { title: "a" })
    saveIssue(store, { title: "b" })
    saveIssue(store, { title: "c" })
    expect(saveIssue(store, { id: "1", addBlocks: ["2"] }).blocks).toEqual(["2"])
    expect(getIssue(store, "2").blockedBy).toEqual(["1"])
    expect(saveIssue(store, { id: "3", addBlockedBy: ["1"] }).blockedBy).toEqual(["1"])
    expect(getIssue(store, "1").blocks).toEqual(["2", "3"])

    expect(saveIssue(store, { id: "1", addBlocks: ["2"] }).blocks).toEqual(["2", "3"])
    expect(saveIssue(store, { id: "1", removeBlocks: ["2"] }).blocks).toEqual(["3"])
    expect(getIssue(store, "2").blockedBy).toEqual([])
    expect(saveIssue(store, { id: "3", removeBlockedBy: ["1"] }).blockedBy).toEqual([])
    expect(getIssue(store, "1").blocks).toEqual([])
  })

  test("blocks replace the outgoing set when blocks is passed", () => {
    const store = workspace()
    saveIssue(store, { title: "a" })
    saveIssue(store, { title: "b" })
    saveIssue(store, { title: "c" })
    saveIssue(store, { id: "1", addBlocks: ["2", "3"] })
    expect(saveIssue(store, { id: "1", blocks: ["3"] }).blocks).toEqual(["3"])
    expect(getIssue(store, "2").blockedBy).toEqual([])
    expect(getIssue(store, "3").blockedBy).toEqual(["1"])
  })

  test("blocks reject self, missing, and cycles", () => {
    const store = workspace()
    saveIssue(store, { title: "a" })
    saveIssue(store, { title: "b" })
    expect(() => saveIssue(store, { id: "1", addBlocks: ["1"] })).toThrow(
      "invalid block: an issue cannot block itself, actual 1",
    )
    expect(() => saveIssue(store, { id: "1", addBlocks: ["9"] })).toThrow(
      "invalid block: issue not found: 9",
    )
    saveIssue(store, { id: "1", addBlocks: ["2"] })
    expect(() => saveIssue(store, { id: "2", addBlocks: ["1"] })).toThrow(
      "invalid block: cycle: 2 already blocked by 1",
    )
  })

  test("comments create, reply, list, and update", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    const created = saveComment(store, { issue: "1", body: "first" })
    expect(created.id).toBe("1")
    expect(created.issue).toBe("1")
    expect(created.parent).toBeNull()
    expect(created.body).toBe("first")
    expect(created.author).toBeTruthy()

    const reply = saveComment(store, { parent: "1", body: "second" })
    expect(reply.parent).toBe("1")
    expect(reply.issue).toBe("1")
    expect(listComments(store, { issue: "1" }).map((comment) => comment.id)).toEqual(["1", "2"])
    expect(getComment(store, "1").body).toBe("first")
    expect(saveComment(store, { id: "1", body: "edited" }).body).toBe("edited")
  })

  test("comments require an issue or parent and a body", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    expect(() => saveComment(store, { body: "x" })).toThrow(
      "issue is required when creating a comment",
    )
    expect(() => saveComment(store, { issue: "1", body: "" })).toThrow(
      'invalid body: expected a non-empty string, actual ""',
    )
    expect(() => saveComment(store, { issue: "9", body: "x" })).toThrow("issue not found: 9")
    expect(() => saveComment(store, { parent: "9", body: "x" })).toThrow("comment not found: 9")
  })
})
