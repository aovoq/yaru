import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { answerQuestion, getQuestion, saveQuestion } from "./questions"
import { init, saveComment, saveIssue } from "./store"
import { createApp, serve } from "./web"

const dirs: string[] = []

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-"))
  dirs.push(root)
  return init(root)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// reader.read() を race で打ち切ると、後から届いた chunk ごと捨ててしまうため、
// 未完了の read を次の待機へ持ち越し、受け取った文字列を累積して判定する
function sseEvents(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let text = ""
  let done = false
  let pending: ReturnType<typeof reader.read> | undefined
  return {
    text: () => text,
    async until(match: (text: string) => boolean, ms: number): Promise<boolean> {
      const deadline = Date.now() + ms
      while (!match(text) && !done) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return false
        pending ??= reader.read()
        const part = await Promise.race([pending, Bun.sleep(remaining).then(() => null)])
        if (!part) return false
        pending = undefined
        if (part.done) done = true
        else text += decoder.decode(part.value, { stream: true })
      }
      return match(text)
    },
  }
}

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
    expect(html).toContain(">1<")
    expect(html).toContain("--color-canvas")
    expect(html).toContain("#5e6ad2")
    expect(html).toContain("--color-semantic-danger")
    expect(html).toContain('id="root"')
    expect(html).toContain('id="yaru-initial-state"')
    expect(html).toContain('src="/assets/app.js"')
  })

  test("GET /assets/app.js returns the browser UI", async () => {
    const res = await createApp(workspace()).request("/assets/app.js")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/javascript")
    const script = await res.text()
    expect(script).toContain("yaru-initial-state")
    expect(script).toContain("EventSource")
  })

  test("GET / sidebar can collapse and resize", async () => {
    const html = await (await createApp(workspace()).request("/")).text()
    expect(html).toContain('id="sidebar"')
    expect(html).toContain('id="sidebar-toggle"')
    expect(html).toContain('id="sidebar-open"')
    expect(html).toContain('id="sidebar-resizer"')
    expect(html).toContain("yaru.sidebar.open")
    expect(html).toContain("yaru.sidebar.width")
    expect(html).toContain("--sidebar-width")
  })

  test("GET /?id= opens drawer", async () => {
    const store = workspace()
    saveIssue(store, { title: "drawer me", body: "hello body" })
    const res = await createApp(store).request("/?id=1")
    const html = await res.text()
    expect(html).toContain('value="drawer me"')
    expect(html).toContain("hello body")
    expect(html).toContain('name="id"')
  })

  test("GET /?status=done filters the board", async () => {
    const store = workspace()
    saveIssue(store, { title: "todo only", status: "todo" })
    saveIssue(store, { title: "done card", status: "done" })
    const res = await createApp(store).request("/?status=done")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("done card")
    expect(html).not.toContain(">todo only<")
  })

  test("GET / defaults to list view", async () => {
    const store = workspace()
    saveIssue(store, { title: "listed" })
    const res = await createApp(store).request("/")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain(">listed<")
    expect(html).toContain(">Todo<")
  })

  test("GET /?view=board returns board", async () => {
    const store = workspace()
    saveIssue(store, { title: "boarded" })
    const res = await createApp(store).request("/?view=board")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("overflow-x-auto")
    expect(html).toContain(">boarded<")
    expect(html).toContain(".w-\\[300px\\]")
    expect(html).toContain(".rounded-lg")
    expect(html).toContain(".shadow-\\[inset_0_1px_0_0_rgb")
  })

  test("POST /issues without title stays in the drawer", async () => {
    const app = createApp(workspace())
    const res = await app.request("/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "", body: "keep me" }).toString(),
    })
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain("title is required")
    expect(html).toContain("keep me")
    expect(html).toContain("Save")
    expect(html).not.toContain(">back<")
  })

  test("GET /events is an event stream", async () => {
    const app = createApp(workspace())
    const ac = new AbortController()
    const res = await app.request("/events", { signal: ac.signal })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    ac.abort()
    await res.body?.cancel()
  })

  test("GET /events flushes a first chunk", async () => {
    const ac = new AbortController()
    const res = await createApp(workspace()).request("/events", { signal: ac.signal })
    const reader = res.body!.getReader()
    const events = sseEvents(reader)
    expect(await events.until((text) => text.includes("\n\n"), 500)).toBe(true)
    expect(events.text().startsWith(":")).toBe(true)
    ac.abort()
    await reader.cancel()
  })

  test("GET /events over HTTP flushes before any file change", async () => {
    const app = createApp(workspace())
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      fetch: app.fetch,
    })
    const ac = new AbortController()
    const kill = setTimeout(() => ac.abort(), 1000)
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/events`, { signal: ac.signal })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("text/event-stream")
      const events = sseEvents(res.body!.getReader())
      expect(await events.until((text) => text.includes("\n\n"), 500)).toBe(true)
      expect(events.text().startsWith(":")).toBe(true)
    } finally {
      clearTimeout(kill)
      ac.abort()
      server.stop()
    }
  })

  test("GET /events emits change after save", async () => {
    const store = workspace()
    const ac = new AbortController()
    const res = await createApp(store).request("/events", { signal: ac.signal })
    const reader = res.body!.getReader()
    const events = sseEvents(reader)
    expect(await events.until((text) => text.includes("\n\n"), 500)).toBe(true)
    // Bun の fs.watch は macOS で監視を始めてから数 ms は変更を拾わない
    // (監視直後の書き込みは 100 回中 5 回取りこぼし、20ms 後なら取りこぼさなかった) ため、
    // 監視が効くまで保存を繰り返し、保存がいずれ change として届くことを確かめる
    let received = false
    for (let attempt = 0; attempt < 20 && !received; attempt++) {
      saveIssue(store, { title: `from cli ${attempt}` })
      received = await events.until((text) => text.includes("data: change"), 100)
    }
    expect(received).toBe(true)
    ac.abort()
    await reader.cancel()
  })

  test("POST /issues creates then lists", async () => {
    const app = createApp(workspace())
    const res = await app.request("/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "from form" }).toString(),
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/")
    const list = await app.request("/api/issues")
    const issues = await list.json()
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe("from form")
  })

  test("POST /issues does not treat issue status as a board filter", async () => {
    const app = createApp(workspace())
    const res = await app.request("/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "move me", status: "done" }).toString(),
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/")
  })

  test("POST /issues preserves filter params", async () => {
    const app = createApp(workspace())
    const res = await app.request("/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        title: "filtered",
        status: "todo",
        query: "needle",
        filter_status: "done",
      }).toString(),
    })
    expect(res.status).toBe(302)
    const location = res.headers.get("location") ?? ""
    expect(location).toContain("query=needle")
    expect(location).toContain("status=done")
    expect(location).not.toContain("todo")
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

  test("GET /api/page returns URL-derived UI state", async () => {
    const store = workspace()
    saveIssue(store, { title: "todo issue", status: "todo" })
    saveIssue(store, { title: "done issue", status: "done" })
    const res = await createApp(store).request("/api/page?status=done&id=2&view=board")
    expect(res.status).toBe(200)
    const page = await res.json()
    expect(page.issues.map((issue: { title: string }) => issue.title)).toEqual(["done issue"])
    expect(page.all).toHaveLength(2)
    expect(page.current.title).toBe("done issue")
    expect(page.status).toBe("done")
    expect(page.view).toBe("board")
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
    expect((await res.json()).id).toBe("1")
  })

  test("serve on a taken port reports already running", () => {
    const first = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("ok"),
    })
    const logs: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "))
    }
    try {
      serve(first.port)
      expect(logs.some((line) => line.includes("already running"))).toBe(true)
      expect(logs.some((line) => line.includes(`127.0.0.1:${first.port}`))).toBe(true)
    } finally {
      console.log = orig
      first.stop()
    }
  })

  test("missing issue is 404", async () => {
    const app = createApp(workspace())
    const api = await app.request("/api/issues/9")
    expect(api.status).toBe(404)
    expect((await api.json()).error).toContain("not found")
    const page = await app.request("/?id=9")
    expect(page.status).toBe(404)
    expect(await page.text()).toContain("not found")
  })

  test("board shows dueDate and marks overdue", async () => {
    const store = workspace()
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    saveIssue(store, { title: "late card", dueDate: yesterday, priority: "high" })
    const html = await (await createApp(store).request("/?view=board")).text()
    expect(html).toContain(yesterday)
    expect(html).toContain("data-overdue")
    expect(html).toContain("text-semantic-danger")
    expect(html).toContain('data-priority="high"')
  })

  test("list view shows dueDate and priority", async () => {
    const store = workspace()
    saveIssue(store, { title: "listed", dueDate: "2026-08-20", priority: "low" })
    const html = await (await createApp(store).request("/")).text()
    expect(html).toContain("2026-08-20")
    expect(html).toContain('data-priority="low"')
    expect(html).toContain(">Todo<")
    expect(html).toContain(">listed<")
  })

  test("drawer has dueDate and priority fields", async () => {
    const store = workspace()
    saveIssue(store, { title: "drawer me", dueDate: "2026-08-20", priority: "medium" })
    const html = await (await createApp(store).request("/?id=1")).text()
    expect(html).toContain('name="dueDate"')
    expect(html).toContain('value="2026-08-20"')
    expect(html).toContain('name="priority"')
    expect(html).toContain('value="medium"')
  })

  test("POST /issues saves dueDate and priority", async () => {
    const app = createApp(workspace())
    const res = await app.request("/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        title: "from form",
        dueDate: "2026-08-20",
        priority: "urgent",
      }).toString(),
    })
    expect(res.status).toBe(302)
    const issue = await (await app.request("/api/issues/1")).json()
    expect(issue.dueDate).toBe("2026-08-20")
    expect(issue.priority).toBe("urgent")
  })

  test("POST /issues invalid dueDate stays in the drawer", async () => {
    const app = createApp(workspace())
    const res = await app.request("/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "bad date", dueDate: "2026-02-30" }).toString(),
    })
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain("invalid dueDate")
    expect(html).toContain("Save")
    expect(html).not.toContain(">back<")
  })

  test("due today is not overdue on the board", async () => {
    const store = workspace()
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    saveIssue(store, { title: "today card", dueDate: today })
    const html = await (await createApp(store).request("/?view=board")).text()
    expect(html).toContain(today)
    expect(html).not.toContain("data-overdue")
  })

  test("POST /issues with only status keeps dueDate and priority", async () => {
    const store = workspace()
    saveIssue(store, {
      title: "move me",
      dueDate: "2026-08-20",
      priority: "high",
      assignee: "voq",
      body: "keep",
    })
    const app = createApp(store)
    const res = await app.request("/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id: "1", status: "done" }).toString(),
    })
    expect(res.status).toBe(302)
    const issue = await (await app.request("/api/issues/1")).json()
    expect(issue.status).toBe("done")
    expect(issue.title).toBe("move me")
    expect(issue.dueDate).toBe("2026-08-20")
    expect(issue.priority).toBe("high")
    expect(issue.body).toBe("keep")
    expect(issue.assignee).toBe("voq")
  })

  test("GET /api/issues?due=overdue", async () => {
    const store = workspace()
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    saveIssue(store, { title: "late", dueDate: yesterday })
    saveIssue(store, { title: "open" })
    const rows = await (await createApp(store).request("/api/issues?due=overdue")).json()
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("late")
  })

  test("GET /api/issues includes parent blocks and timestamps", async () => {
    const store = workspace()
    saveIssue(store, { title: "parent" })
    saveIssue(store, { title: "child", parent: "1", status: "in_progress" })
    saveIssue(store, { id: "1", addBlocks: ["2"] })
    const child = await (await createApp(store).request("/api/issues/2")).json()
    expect(child.parent).toBe("1")
    expect(child.blockedBy).toEqual(["1"])
    expect(child.startedAt).toBeTruthy()
    const parent = await (await createApp(store).request("/api/issues/1")).json()
    expect(parent.blocks).toEqual(["2"])
    expect(parent.children).toEqual(["2"])
  })

  test("comments API creates and lists", async () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    const app = createApp(store)
    const created = await app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issue: "1", body: "hello" }),
    })
    expect(created.status).toBe(200)
    expect((await created.json()).body).toBe("hello")
    const listed = await (await app.request("/api/comments?issue=1")).json()
    expect(listed).toHaveLength(1)
  })

  test("GET /?id= shows parent blocks and comments", async () => {
    const store = workspace()
    saveIssue(store, { title: "parent" })
    saveIssue(store, { title: "child", parent: "1" })
    saveComment(store, { issue: "2", body: "note" })
    const html = await (await createApp(store).request("/?id=2")).text()
    expect(html).toContain("Parent")
    expect(html).toContain("Blocks")
    expect(html).toContain("Comments")
    expect(html).toContain("note")
  })

  test("GET /dashboard shows open questions with the default action and answer form", async () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(store, {
      title: "称号を消すか",
      issue: "1",
      priority: "high",
      defaultAction: "残す",
      answerBy: "2h",
      body: "背景の説明",
    })
    saveQuestion(store, { title: "答え済み" })
    answerQuestion(store, "2", { body: "はい" })
    const res = await createApp(store).request("/dashboard")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<meta name="viewport"')
    expect(html).toContain("称号を消すか")
    expect(html).toContain("残す")
    expect(html).toContain("背景の説明")
    expect(html).toContain('action="/questions/1/answer"')
    expect(html).toContain('name="useDefault"')
    expect(html).toContain('href="/?id=1"')
    expect(html).toContain("答え済み")
    expect(html).toContain("はい")
    expect(html).not.toContain('action="/questions/2/answer"')
  })

  test("GET /dashboard marks expired questions and lists in-progress and overdue issues", async () => {
    const store = workspace()
    saveQuestion(store, {
      title: "過ぎた",
      answerBy: "2020-01-01T00:00:00Z",
      defaultAction: "進める",
    })
    saveIssue(store, { title: "作業中", status: "in_progress" })
    saveIssue(store, { title: "期限切れ", dueDate: "2020-01-01" })
    const html = await (await createApp(store).request("/dashboard")).text()
    expect(html).toContain('data-question-status="expired"')
    expect(html).toContain("作業中")
    expect(html).toContain("期限切れ")
  })

  test("POST /questions/:id/answer saves the answer and redirects to the dashboard", async () => {
    const store = workspace()
    saveQuestion(store, { title: "q" })
    const res = await createApp(store).request("/questions/1/answer", {
      method: "POST",
      body: new URLSearchParams({ body: "消してよい" }),
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/dashboard")
    expect(getQuestion(store, "1")).toMatchObject({ status: "answered", answer: "消してよい" })
  })

  test("POST /questions/:id/answer with useDefault answers with the default action", async () => {
    const store = workspace()
    saveQuestion(store, { title: "q", defaultAction: "残す" })
    await createApp(store).request("/questions/1/answer", {
      method: "POST",
      body: new URLSearchParams({ useDefault: "1" }),
    })
    expect(getQuestion(store, "1").answer).toBe("Go with the default action: 残す")
  })

  test("POST /questions/:id/answer with an empty body shows the error on the dashboard", async () => {
    const store = workspace()
    saveQuestion(store, { title: "q" })
    const res = await createApp(store).request("/questions/1/answer", {
      method: "POST",
      body: new URLSearchParams({ body: "" }),
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("invalid answer: expected a non-empty string")
  })

  test("questions API lists and answers", async () => {
    const store = workspace()
    const app = createApp(store)
    saveQuestion(store, { title: "q" })
    const listed = await (await app.request("/api/questions?status=open")).json()
    expect(listed.questions.map((question: { id: string }) => question.id)).toEqual(["1"])
    const answered = await (
      await app.request("/api/questions/1/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "yes" }),
      })
    ).json()
    expect(answered.status).toBe("answered")
  })

  test("GET /events emits change after a question is asked", async () => {
    const store = workspace()
    const ac = new AbortController()
    const res = await createApp(store).request("/events", { signal: ac.signal })
    const reader = res.body!.getReader()
    const events = sseEvents(reader)
    expect(await events.until((text) => text.includes("\n\n"), 500)).toBe(true)
    // 監視の立ち上がりの取りこぼしは issue の change テストと同じ理由で繰り返して吸収する
    let received = false
    for (let attempt = 0; attempt < 20 && !received; attempt++) {
      saveQuestion(store, { title: `from agent ${attempt}` })
      received = await events.until((text) => text.includes("data: change"), 100)
    }
    expect(received).toBe(true)
    ac.abort()
    await reader.cancel()
  })

  test("board sidebar links to the dashboard with the count of questions awaiting an answer", async () => {
    const store = workspace()
    saveQuestion(store, { title: "a" })
    saveQuestion(store, { title: "b", answerBy: "2020-01-01T00:00:00Z" })
    saveQuestion(store, { title: "c", status: "canceled" })
    const html = await (await createApp(store).request("/")).text()
    expect(html).toMatch(/href="\/dashboard"[\s\S]*?Dashboard[\s\S]*?>2</)
  })

  test("GET /dashboard says so when this workspace has no Claude Code sessions", async () => {
    const html = await (await createApp(workspace()).request("/dashboard")).text()
    expect(html).toContain("Agent sessions")
    expect(html).toContain("No Claude Code sessions in the last 7 days")
  })

  test("the mobile status bar links to the dashboard since the sidebar is hidden on phones", async () => {
    const store = workspace()
    saveQuestion(store, { title: "a" })
    const html = await (await createApp(store).request("/")).text()
    expect(html).toMatch(
      /id="mobile-dashboard-link"[^>]*href="\/dashboard"[\s\S]*?Dashboard[\s\S]*?1/,
    )
  })

  test("the issue drawer shows its questions with an answer form for the open ones", async () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(store, { title: "消すか", issue: "1", defaultAction: "残す", body: "背景" })
    saveQuestion(store, { title: "答え済み", issue: "1" })
    answerQuestion(store, "2", { body: "はい" })
    saveQuestion(store, { title: "別の issue の質問" })
    const html = await (await createApp(store).request("/?id=1&status=todo")).text()
    expect(html).toContain("Questions")
    expect(html).toContain("消すか")
    expect(html).toContain("残す")
    expect(html).toContain("背景")
    expect(html).toContain('action="/questions/1/answer"')
    expect(html).toContain('name="returnTo" value="/?status=todo&amp;id=1"')
    expect(html).toContain("答え済み")
    expect(html).toContain("はい")
    expect(html).not.toContain('action="/questions/2/answer"')
    expect(html).not.toContain("別の issue の質問")
  })

  test("answering from the drawer returns to the issue", async () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(store, { title: "q", issue: "1" })
    const res = await createApp(store).request("/questions/1/answer", {
      method: "POST",
      body: new URLSearchParams({ body: "yes", returnTo: "/?status=todo&id=1" }),
    })
    expect(res.headers.get("location")).toBe("/?status=todo&id=1")
  })

  test("answering ignores a returnTo outside the board", async () => {
    const store = workspace()
    saveQuestion(store, { title: "a" })
    saveQuestion(store, { title: "b" })
    const app = createApp(store)
    for (const [id, returnTo] of [
      ["1", "//evil.example/"],
      ["2", "https://evil.example/"],
    ] as const) {
      const res = await app.request(`/questions/${id}/answer`, {
        method: "POST",
        body: new URLSearchParams({ body: "yes", returnTo }),
      })
      expect(res.headers.get("location")).toBe("/dashboard")
    }
  })
})
