import { Hono } from "hono"
import { jsxRenderer } from "hono/jsx-renderer"
import { styles } from "./css"
import { getIssue, listIssues, saveIssue, type SaveInput, type Store } from "./store"
import { BLANK, BoardPage, Document, ErrorView } from "./ui"

export const DEFAULT_PORT = 47800

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
    const issues = listIssues(store, { query: query || undefined })
    const current = id === "new" ? BLANK : id ? getIssue(store, id) : null
    return c.render(<BoardPage issues={issues} query={query} current={current} />)
  })

  app.post("/issues", async (c) => {
    const body = await c.req.parseBody()
    saveIssue(store, {
      id: str(body.id) || undefined,
      title: str(body.title),
      status: str(body.status) || undefined,
      assignee: str(body.assignee),
      labels: str(body.labels)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      body: str(body.body),
    })
    const query = str(body.query)
    return c.redirect(query ? `/?query=${encodeURIComponent(query)}` : "/")
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
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  })
  console.log(`yaru  http://127.0.0.1:${server.port}`)
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}
