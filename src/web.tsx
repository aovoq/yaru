import { watch } from "node:fs"
import { join } from "node:path"
import { Hono } from "hono"
import { jsxRenderer } from "hono/jsx-renderer"
import { styles } from "./css"
import { getIssue, listIssues, saveIssue, type Issue, type SaveInput, type Store } from "./store"
import { BLANK, BoardPage, Document, ErrorView } from "./ui"

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
    const query = c.req.query("query") || ""
    const id = c.req.query("id")
    const status = c.req.query("status") || undefined
    const assignee = c.req.query("assignee") || undefined
    const label = c.req.query("label") || undefined
    const view = c.req.query("view") === "list" ? "list" : "board"
    const issues = listIssues(store, {
      query: query || undefined,
      status,
      assignee,
      label,
    })
    const current = id === "new" ? BLANK : id ? getIssue(store, id) : null
    return c.render(
      <BoardPage
        issues={issues}
        query={query}
        current={current}
        status={status}
        assignee={assignee}
        label={label}
        view={view}
      />,
    )
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
        title: draft.title,
        status: draft.status,
        assignee: draft.assignee,
        labels: draft.labels,
        body: draft.body,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes("title is required")) throw err
      c.status(400)
      return c.render(
        <BoardPage
          issues={listIssues(store, {
            query: filters.query || undefined,
            status: filters.status || undefined,
            assignee: filters.assignee || undefined,
            label: filters.label || undefined,
          })}
          query={filters.query}
          current={draft}
          status={filters.status || undefined}
          assignee={filters.assignee || undefined}
          label={filters.label || undefined}
          view={filters.view === "list" ? "list" : "board"}
          error={message}
        />,
      )
    }
    return c.redirect(hrefFrom(filters))
  })

  app.get("/events", (c) => {
    const encoder = new TextEncoder()
    let watcher: ReturnType<typeof watch> | undefined
    let ping: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream({
      start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {}
        }
        send(": connected\n\n")
        const target = join(store.dir, "issues")
        try {
          watcher = watch(target, () => send("data: change\n\n"))
        } catch {
          watcher = watch(store.dir, { recursive: true }, () => send("data: change\n\n"))
        }
        ping = setInterval(() => send(": ping\n\n"), 5000)
        const close = () => {
          if (ping) clearInterval(ping)
          watcher?.close()
          try {
            controller.close()
          } catch {}
        }
        c.req.raw.signal.addEventListener("abort", close)
      },
      cancel() {
        if (ping) clearInterval(ping)
        watcher?.close()
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
      }),
    )
  })

  app.get("/api/issues/:id", (c) => {
    return c.json(getIssue(store, c.req.param("id")))
  })

  app.post("/api/issues", async (c) => {
    const input = await c.req.json<SaveInput>()
    return c.json(saveIssue(store, input))
  })

  return app
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
    body: str(body.body),
  }
}
