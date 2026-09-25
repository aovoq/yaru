import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getQuestion, saveQuestion } from "./questions"
import { init, open, saveIssue } from "./store"
import { createServerApp } from "./web"
import { registerWorkspace } from "./workspaces"

const dirs: string[] = []

function directory(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(path)
  return path
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// 2 つのワークスペースを登録した状態の yaru serve を作る
function server() {
  const state = directory("yaru-state-")
  const projects = directory("yaru-projects-")
  const roots = ["AsukaTravel", "other"].map((name) => {
    const root = join(projects, name)
    mkdirSync(root)
    init(root)
    registerWorkspace(root, state)
    return root
  })
  return {
    app: createServerApp(state),
    asuka: open(roots[0]!),
    other: open(roots[1]!),
  }
}

describe("server", () => {
  test("the top page lists every workspace with its questions awaiting an answer", async () => {
    const { app, asuka, other } = server()
    saveQuestion(asuka, { title: "称号を消すか" })
    saveQuestion(asuka, { title: "期限切れ", answerBy: "2020-01-01T00:00:00Z" })
    saveIssue(other, { title: "作業中", status: "in_progress" })
    const res = await app.request("/")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('href="/p/AsukaTravel/dashboard"')
    expect(html).toContain('href="/p/other/dashboard"')
    expect(html).toContain("称号を消すか")
    expect(html).toMatch(/data-workspace="AsukaTravel"[\s\S]*?data-awaiting="2"/)
    expect(html).toMatch(/data-workspace="other"[\s\S]*?data-awaiting="0"/)
  })

  test("a workspace's board and dashboard are served under /p/<name>/ with prefixed links", async () => {
    const { app, asuka } = server()
    saveIssue(asuka, { title: "topic" })
    saveQuestion(asuka, { title: "q", issue: "1" })
    const board = await (await app.request("/p/AsukaTravel/?id=1")).text()
    expect(board).toContain("topic")
    expect(board).toContain('href="/p/AsukaTravel/dashboard"')
    expect(board).toContain('action="/p/AsukaTravel/questions/1/answer"')
    expect(board).toContain('"basePath":"/p/AsukaTravel"')
    const dashboard = await (await app.request("/p/AsukaTravel/dashboard")).text()
    expect(dashboard).toContain('action="/p/AsukaTravel/questions/1/answer"')
    expect(dashboard).toContain('href="/p/AsukaTravel/?id=1"')
    expect(dashboard).toContain('new EventSource("/p/AsukaTravel/events")')
  })

  test("answering under a workspace saves to that workspace and redirects inside it", async () => {
    const { app, asuka, other } = server()
    saveQuestion(asuka, { title: "q" })
    saveQuestion(other, { title: "q" })
    const res = await app.request("/p/AsukaTravel/questions/1/answer", {
      method: "POST",
      body: new URLSearchParams({ body: "yes" }),
    })
    expect(res.headers.get("location")).toBe("/p/AsukaTravel/dashboard")
    expect(getQuestion(asuka, "1").status).toBe("answered")
    expect(getQuestion(other, "1").status).toBe("open")
  })

  test("a returnTo into another workspace is ignored", async () => {
    const { app, asuka } = server()
    saveQuestion(asuka, { title: "q" })
    const res = await app.request("/p/AsukaTravel/questions/1/answer", {
      method: "POST",
      body: new URLSearchParams({ body: "yes", returnTo: "/p/other/?id=1" }),
    })
    expect(res.headers.get("location")).toBe("/p/AsukaTravel/dashboard")
  })

  test("the workspace API answers under its prefix", async () => {
    const { app, asuka } = server()
    saveIssue(asuka, { title: "topic" })
    const page = await (await app.request("/p/AsukaTravel/api/page")).json()
    expect(page.issues.map((issue: { title: string }) => issue.title)).toEqual(["topic"])
  })

  test("a workspace path without the trailing slash redirects to the board", async () => {
    const { app } = server()
    const res = await app.request("/p/AsukaTravel")
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/p/AsukaTravel/")
  })

  test("an unknown workspace is 404", async () => {
    const { app } = server()
    expect((await app.request("/p/missing/dashboard")).status).toBe(404)
  })

  test("the browser script is served once for every workspace", async () => {
    const { app } = server()
    const res = await app.request("/assets/app.js")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("javascript")
  })
})
