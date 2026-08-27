import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findRoot, getIssue, init, listIssues, open, saveIssue } from "./store"

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

  test("save with unused id creates it", () => {
    const store = workspace()
    expect(saveIssue(store, { id: "7", title: "explicit" }).id).toBe("7")
    expect(getIssue(store, "7").title).toBe("explicit")
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
    expect(() => saveIssue(store, { title: "x", dueDate: "2026-02-30" })).toThrow(/invalid dueDate/)
    expect(() => saveIssue(store, { title: "x", dueDate: "2026-08-20T00:00:00Z" })).toThrow(
      /invalid dueDate/,
    )
    expect(() => saveIssue(store, { title: "x", dueDate: "08-20" })).toThrow(/invalid dueDate/)
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
    expect(() => saveIssue(store, { title: "x", priority: "p0" })).toThrow(/invalid priority/)
    expect(() => saveIssue(store, { title: "x", priority: "0" })).toThrow(/invalid priority/)
    expect(() => saveIssue(store, { title: "x", priority: "Urgent" })).toThrow(/invalid priority/)
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
})
