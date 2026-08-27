import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findRoot, getIssue, init, listIssues, open, saveIssue } from "./store"

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
})
