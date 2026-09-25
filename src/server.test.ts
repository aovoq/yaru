import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { answerQuestion, getQuestion, saveQuestion } from "./questions"
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
    expect(res.headers.get("location")).toBe("/p/AsukaTravel/dashboard#q-1")
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
    expect(res.headers.get("location")).toBe("/p/AsukaTravel/dashboard#q-1")
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

  test("the inbox API merges every workspace's awaiting questions into the shared groups", async () => {
    const { app, asuka, other } = server()
    saveQuestion(asuka, { title: "blocking in asuka" })
    saveQuestion(other, { title: "due later", defaultAction: "x", answerBy: "3h" })
    saveQuestion(asuka, { title: "due soon", defaultAction: "x", answerBy: "1h" })
    saveQuestion(other, { title: "no deadline", defaultAction: "x" })
    saveQuestion(other, {
      title: "proceeded",
      defaultAction: "x",
      answerBy: "2020-01-01T00:00:00Z",
    })
    saveQuestion(asuka, { title: "answered" })
    answerQuestion(asuka, "3", { body: "yes" })
    const res = await app.request("/api/inbox")
    expect(res.status).toBe(200)
    const inbox = await res.json()
    const titles = (group: { question: { title: string } }[]) =>
      group.map((item) => item.question.title)
    expect(titles(inbox.groups.blocking)).toEqual(["blocking in asuka"])
    expect(titles(inbox.groups.dueSoon)).toEqual(["due soon", "due later"])
    expect(titles(inbox.groups.noDeadline)).toEqual(["no deadline"])
    expect(titles(inbox.groups.proceeded)).toEqual(["proceeded"])
    expect(inbox.groups.blocking[0]).toMatchObject({
      workspace: "AsukaTravel",
      basePath: "/p/AsukaTravel",
      href: "/p/AsukaTravel/dashboard#q-1",
      anchor: "q-AsukaTravel-1",
    })
    expect(inbox.workspaces).toEqual([
      { slug: "AsukaTravel", basePath: "/p/AsukaTravel", awaiting: 2 },
      { slug: "other", basePath: "/p/other", awaiting: 3 },
    ])
  })

  test("inbox groups order questions across workspaces, not workspace by workspace", async () => {
    const { app, asuka, other } = server()
    saveQuestion(asuka, { title: "asuka later", defaultAction: "x", answerBy: "3h" })
    saveQuestion(other, { title: "other sooner", defaultAction: "x", answerBy: "1h" })
    const inbox = await (await app.request("/api/inbox")).json()
    expect(
      inbox.groups.dueSoon.map((item: { question: { title: string } }) => item.question.title),
    ).toEqual(["other sooner", "asuka later"])
  })
})
