import { existsSync, mkdirSync, watch } from "node:fs"
import { join } from "node:path"
import { Hono } from "hono"
import { jsxRenderer } from "hono/jsx-renderer"
import { clientScript } from "./client-script"
import { styles } from "./css"
import { DashboardPage, DASHBOARD_LIVE_RELOAD, USE_DEFAULT_ANSWER_PREFIX } from "./dashboard"
import { getPageData } from "./page"
import { answerQuestion, getQuestion, listQuestions } from "./questions"
import { readRepositoryState } from "./repository"
import { readSessionHealth } from "./sessions"
import {
  getIssue,
  listComments,
  listIssues,
  saveComment,
  saveIssue,
  type Issue,
  type SaveInput,
  type Store,
} from "./store"
import { BLANK, BoardPage, Document, ErrorView, parseView } from "./ui"

export const DEFAULT_PORT = 47800

const FILTER_KEYS = ["query", "status", "assignee", "label", "view"] as const

export function createApp(store: Store) {
  const app = new Hono()

  app.use(
    jsxRenderer(async ({ children }) => <Document css={await styles()}>{children}</Document>, {
      docType: true,
    }),
  )

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes("not found") ? 404 : 400
    if (c.req.path.startsWith("/api/")) return c.json({ error: message }, status)
    c.status(status)
    return c.render(<ErrorView message={message} />)
  })

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404)
    c.status(404)
    return c.render(<ErrorView message="not found" />)
  })

  app.get("/", (c) => {
    return c.render(<BoardPage {...getPageData(store, new URL(c.req.url))} />)
  })

  app.get("/dashboard", async (c) => {
    return c.html(await renderDashboard(store))
  })

  app.post("/questions/:id/answer", async (c) => {
    const body = await c.req.parseBody()
    const id = c.req.param("id")
    try {
      const answer =
        str(body.useDefault) === "1"
          ? `${USE_DEFAULT_ANSWER_PREFIX}${getQuestion(store, id).defaultAction ?? ""}`
          : str(body.body)
      answerQuestion(store, id, { body: answer })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.html(await renderDashboard(store, message), 400)
    }
    return c.redirect("/dashboard")
  })

  app.get("/api/questions", (c) => {
    return c.json({
      questions: listQuestions(store, {
        status: c.req.query("status") || undefined,
        issue: c.req.query("issue") || undefined,
      }),
    })
  })

  app.get("/api/questions/:id", (c) => {
    return c.json(getQuestion(store, c.req.param("id")))
  })

  app.post("/api/questions/:id/answer", async (c) => {
    const input = await c.req.json<{ body?: string }>()
    return c.json(answerQuestion(store, c.req.param("id"), { body: input.body }))
  })

  app.get("/assets/app.js", async (c) => {
    return c.body(await clientScript(), 200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
    })
  })

  app.post("/issues", async (c) => {
    const body = await c.req.parseBody()
    const filters = {
      query: c.req.query("query") || str(body.query),
      view: c.req.query("view") || str(body.view),
      label: c.req.query("label") || str(body.label),
      status: c.req.query("status") || str(body.filter_status),
      assignee: c.req.query("assignee") || str(body.filter_assignee),
    }
    const draft = draftFrom(body)
    try {
      saveIssue(store, {
        id: draft.id || undefined,
        title: "title" in body ? draft.title : undefined,
        status: "status" in body ? draft.status : undefined,
        assignee: "assignee" in body ? draft.assignee : undefined,
        labels: "labels" in body ? draft.labels : undefined,
        dueDate: "dueDate" in body ? draft.dueDate : undefined,
        priority: "priority" in body ? draft.priority : undefined,
        parent: "parent" in body ? draft.parent : undefined,
        blocks: "blocks" in body ? draft.blocks : undefined,
        body: "body" in body ? draft.body : undefined,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      c.status(400)
      return c.render(
        <BoardPage
          issues={listIssues(store, {
            query: filters.query || undefined,
            status: filters.status || undefined,
            assignee: filters.assignee || undefined,
            label: filters.label || undefined,
          })}
          all={listIssues(store)}
          query={filters.query}
          current={draft}
          status={filters.status || undefined}
          assignee={filters.assignee || undefined}
          label={filters.label || undefined}
          view={parseView(filters.view)}
          comments={draft.id ? listComments(store, { issue: draft.id }) : []}
          error={message}
        />,
      )
    }
    return c.redirect(hrefFrom(filters))
  })

  app.get("/events", (c) => {
    const encoder = new TextEncoder()
    let watchers: ReturnType<typeof watch>[] = []
    let ping: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream({
      start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {}
        }
        send(": connected\n\n")
        const sendChange = () => send("data: change\n\n")
        const issuesDir = join(store.dir, "issues")
        try {
          watchers.push(watch(issuesDir, sendChange))
        } catch {
          watchers.push(watch(store.dir, { recursive: true }, sendChange))
        }
        // 質問はエージェントが初めて聞いたときに作られるので、監視の前に用意しておく
        const questionsDir = join(store.dir, "questions")
        try {
          mkdirSync(questionsDir, { recursive: true })
          watchers.push(watch(questionsDir, sendChange))
        } catch {}
        const commentsDir = join(store.dir, "comments")
        if (existsSync(commentsDir)) {
          try {
            watchers.push(watch(commentsDir, sendChange))
          } catch {}
        }
        ping = setInterval(() => send(": ping\n\n"), 5000)
        const close = () => {
          if (ping) clearInterval(ping)
          for (const watcher of watchers) watcher.close()
          watchers = []
          try {
            controller.close()
          } catch {}
        }
        c.req.raw.signal.addEventListener("abort", close)
      },
      cancel() {
        if (ping) clearInterval(ping)
        for (const watcher of watchers) watcher.close()
        watchers = []
      },
    })
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    })
  })

  app.get("/api/issues", (c) => {
    return c.json(
      listIssues(store, {
        status: c.req.query("status") || undefined,
        assignee: c.req.query("assignee") || undefined,
        label: c.req.query("label") || undefined,
        query: c.req.query("query") || undefined,
        due: c.req.query("due") === "overdue" ? "overdue" : undefined,
      }),
    )
  })

  app.get("/api/page", (c) => {
    return c.json(getPageData(store, new URL(c.req.url)))
  })

  app.get("/api/issues/:id", (c) => {
    return c.json(getIssue(store, c.req.param("id")))
  })

  app.post("/api/issues", async (c) => {
    const input = await c.req.json<SaveInput>()
    return c.json(saveIssue(store, input))
  })

  app.get("/api/comments", (c) => {
    const issue = c.req.query("issue")
    if (!issue) throw new Error("issue is required when listing comments")
    return c.json(listComments(store, { issue }))
  })

  app.post("/api/comments", async (c) => {
    return c.json(saveComment(store, await c.req.json()))
  })

  app.post("/comments", async (c) => {
    const body = await c.req.parseBody()
    const saved = saveComment(store, {
      issue: str(body.issue) || undefined,
      parent: str(body.parent) || undefined,
      body: str(body.body),
    })
    const params = new URLSearchParams()
    for (const key of FILTER_KEYS) {
      const value = c.req.query(key) || str(body[key])
      if (value) params.set(key, value)
    }
    params.set("id", saved.issue)
    const qs = params.toString()
    return c.redirect(qs ? `/?${qs}` : `/?id=${encodeURIComponent(saved.issue)}`)
  })

  return app
}

async function renderDashboard(store: Store, error?: string): Promise<string> {
  const now = new Date()
  const page = (
    <Document css={await styles()} script={DASHBOARD_LIVE_RELOAD}>
      <DashboardPage
        questions={listQuestions(store, {}, now)}
        issues={listIssues(store)}
        now={now}
        sessionHealth={readSessionHealth(store.root, { now })}
        repository={readRepositoryState(store.root)}
        error={error}
      />
    </Document>
  )
  return `<!DOCTYPE html>${await page}`
}

export function serve(store: Store, port = DEFAULT_PORT) {
  const app = createApp(store)
  try {
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      fetch(req, bun) {
        bun.timeout(req, 0)
        return app.fetch(req)
      },
    })
    console.log(`yaru  http://127.0.0.1:${server.port}`)
  } catch (err) {
    if (isAddrInUse(err)) {
      console.log(`yaru  already running  http://127.0.0.1:${port}`)
      return
    }
    throw err
  }
}

function isAddrInUse(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "EADDRINUSE"
}

function hrefFrom(source: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = str(source[key])
    if (value) params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `/?${qs}` : "/"
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function draftFrom(body: Record<string, unknown>): Issue {
  return {
    ...BLANK,
    id: str(body.id),
    title: str(body.title),
    status: str(body.status) || "todo",
    assignee: str(body.assignee) || null,
    labels: str(body.labels)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dueDate: str(body.dueDate) || null,
    priority: (str(body.priority) || null) as Issue["priority"],
    parent: str(body.parent) || null,
    blocks: str(body.blocks)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    body: str(body.body),
  }
}
