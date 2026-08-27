import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { init, saveIssue } from "./store"
import { createApp } from "./web"

const dirs: string[] = []

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-"))
  dirs.push(root)
  return init(root)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("web", () => {
  test("GET / renders issues", async () => {
    const store = workspace()
    saveIssue(store, { title: "first card" })
    const res = await createApp(store).request("/")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("first card")
    expect(html).toContain("YAR-1")
    expect(html).toContain("--color-paper")
  })

  test("GET /?id= opens drawer", async () => {
    const store = workspace()
    saveIssue(store, { title: "drawer me", body: "hello body" })
    const res = await createApp(store).request("/?id=YAR-1")
    const html = await res.text()
    expect(html).toContain('value="drawer me"')
    expect(html).toContain("hello body")
    expect(html).toContain('name="id"')
  })

  test("POST /issues creates then lists", async () => {
    const app = createApp(workspace())
    const res = await app.request("/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "from form", status: "todo" }).toString(),
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/")
    const list = await app.request("/api/issues")
    const issues = await list.json()
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe("from form")
  })

  test("GET /api/issues json and filters", async () => {
    const store = workspace()
    saveIssue(store, { title: "keep", status: "todo" })
    saveIssue(store, { title: "done one", status: "done" })
    const app = createApp(store)
    const all = await app.request("/api/issues")
    expect(await all.json()).toHaveLength(2)
    const filtered = await app.request("/api/issues?status=done")
    const rows = await filtered.json()
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("done one")
  })

  test("GET /api/issues/:id", async () => {
    const store = workspace()
    saveIssue(store, { title: "one" })
    const res = await createApp(store).request("/api/issues/1")
    expect(res.status).toBe(200)
    expect((await res.json()).title).toBe("one")
  })

  test("POST /api/issues json", async () => {
    const app = createApp(workspace())
    const res = await app.request("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "via api" }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe("YAR-1")
  })

  test("missing issue is 404", async () => {
    const app = createApp(workspace())
    const api = await app.request("/api/issues/YAR-9")
    expect(api.status).toBe(404)
    expect((await api.json()).error).toContain("not found")
    const page = await app.request("/?id=YAR-9")
    expect(page.status).toBe(404)
    expect(await page.text()).toContain("not found")
  })
})
