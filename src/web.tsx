import { existsSync, watch } from "node:fs"
import { join } from "node:path"
import { Hono, type Context } from "hono"
import { clientScript } from "./client-script"
import { styles } from "./css"
import { DashboardPage, USE_DEFAULT_ANSWER_PREFIX } from "./dashboard"
import { dashboardLiveReload } from "./dashboard/live-reload"
import { BLANK, getPageData, parseView } from "./page"
import { registerPwaRoutes } from "./pwa"
import { PROJECTS_AUTO_RELOAD, ProjectsPage, type ProjectSummary } from "./projects"
import { answerQuestion, ensureQuestionsDirectory, getQuestion, listQuestions } from "./questions"
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
  open,
  type Store,
} from "./store"
import { BoardPage } from "./ui/board-page"
import { ErrorView } from "./ui/error-view"
import { renderDocument } from "./ui/render-document"
import { findWorkspace, listWorkspaces, stateDirectory, type Workspace } from "./workspaces"

export const DEFAULT_PORT = 47800

const FILTER_KEYS = ["query", "status", "assignee", "label", "view"] as const

export type WorkspaceAppOptions = {
  // 1 つの yaru serve で複数のワークスペースを配るときの URL の接頭辞 (例: /p/app)。単独なら ""
  basePath?: string
  workspaceName?: string
}

export function createApp(store: Store, options: WorkspaceAppOptions = {}) {
  const app = new Hono()
  const basePath = options.basePath ?? ""
  const renderDashboardFor = (error?: string) =>
    renderDashboard(store, { basePath, workspaceName: options.workspaceName }, error)

  app.onError(async (err, c) => {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes("not found") ? 404 : 400
    if (c.req.path.startsWith("/api/")) return c.json({ error: message }, status)
    return c.html(renderDocument(await styles(), <ErrorView message={message} />), status)
  })

  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404)
    return c.html(renderDocument(await styles(), <ErrorView message="not found" />), 404)
  })

  app.get("/", async (c) => {
    return c.html(
      renderDocument(
        await styles(),
        <BoardPage {...getPageData(store, new URL(c.req.url), basePath)} />,
      ),
    )
  })

  app.get("/dashboard", async (c) => {
    return c.html(await renderDashboardFor())
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
      return c.html(await renderDashboardFor(message), 400)
    }
    return c.redirect(boardReturnPath(str(body.returnTo), basePath))
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

  app.get("/assets/app.js", serveClientScript)
  registerPwaRoutes(app)

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
      return c.html(
        renderDocument(
          await styles(),
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
            basePath={basePath}
            error={message}
          />,
        ),
        400,
      )
    }
    return c.redirect(hrefFrom(filters, basePath))
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
        try {
          watchers.push(watch(ensureQuestionsDirectory(store), sendChange))
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
    return c.json(getPageData(store, new URL(c.req.url), basePath))
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
    return c.redirect(
      qs ? `${basePath}/?${qs}` : `${basePath}/?id=${encodeURIComponent(saved.issue)}`,
    )
  })

  return app
}

async function renderDashboard(
  store: Store,
  options: { basePath: string; workspaceName?: string },
  error?: string,
): Promise<string> {
  const now = new Date()
  return renderDocument(
    await styles(),
    <DashboardPage
      questions={listQuestions(store, {}, now)}
      issues={listIssues(store)}
      now={now}
      sessionHealth={readSessionHealth(store.root, { now })}
      repository={readRepositoryState(store.root)}
      basePath={options.basePath}
      workspaceName={options.workspaceName}
      error={error}
    />,
    dashboardLiveReload(options.basePath),
  )
}

async function serveClientScript(c: Context) {
  return c.body(await clientScript(), 200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-cache",
  })
}

// 1 つの yaru serve で、登録された全ワークスペースを /p/<slug>/ の下に配る
// 各ワークスペースのアプリは接頭辞を知らないまま動くよう、接頭辞を外した URL で呼ぶ。リンクを作るときだけ basePath を使う
export function createServerApp(directory = stateDirectory()) {
  const app = new Hono()
  const workspaceApps = new Map<string, { root: string; app: Hono }>()
  const appFor = (workspace: Workspace): Hono => {
    const cached = workspaceApps.get(workspace.slug)
    if (cached && cached.root === workspace.root) return cached.app
    const created = createApp(open(workspace.root), {
      basePath: workspaceBasePath(workspace.slug),
      workspaceName: workspace.slug,
    })
    workspaceApps.set(workspace.slug, { root: workspace.root, app: created })
    return created
  }

  app.notFound(async (c) => {
    return c.html(renderDocument(await styles(), <ErrorView message="not found" />), 404)
  })

  app.get("/", async (c) => {
    return c.html(await renderProjects(directory))
  })

  app.get("/assets/app.js", serveClientScript)
  registerPwaRoutes(app)

  app.get("/p/:slug", (c) => c.redirect(`${workspaceBasePath(c.req.param("slug"))}/`))

  app.all("/p/:slug/*", async (c) => {
    const workspace = findWorkspace(c.req.param("slug"), directory)
    if (!workspace) {
      return c.html(
        renderDocument(
          await styles(),
          <ErrorView message={`workspace not found: ${c.req.param("slug")}`} />,
        ),
        404,
      )
    }
    const url = new URL(c.req.url)
    url.pathname = url.pathname.slice(workspaceBasePath(workspace.slug).length) || "/"
    const raw = c.req.raw
    // SSE の監視を切断で止められるよう、signal も引き継ぐ
    const forwarded = new Request(url, {
      method: raw.method,
      headers: raw.headers,
      body: raw.method === "GET" || raw.method === "HEAD" ? undefined : raw.body,
      signal: raw.signal,
      duplex: "half",
    } as RequestInit)
    return appFor(workspace).fetch(forwarded)
  })

  return app
}

function workspaceBasePath(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`
}

async function renderProjects(directory: string): Promise<string> {
  const now = new Date()
  const projects: ProjectSummary[] = listWorkspaces(directory).map((workspace) => {
    const store = open(workspace.root)
    return {
      slug: workspace.slug,
      root: workspace.root,
      awaiting: listQuestions(store, {}, now).filter(
        (question) => question.status === "open" || question.status === "expired",
      ),
      inProgress: listIssues(store, { status: "in_progress" }).length,
    }
  })
  return renderDocument(await styles(), <ProjectsPage projects={projects} />, PROJECTS_AUTO_RELOAD)
}

export function serve(port = DEFAULT_PORT) {
  const app = createServerApp()
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

function hrefFrom(source: Record<string, unknown>, basePath: string): string {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = str(source[key])
    if (value) params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `${basePath}/?${qs}` : `${basePath}/`
}

// 回答後の戻り先はこのワークスペースの板の中だけに限る
// 外部の URL へ飛ばされないよう、<basePath>/? で始まる板の URL 以外は dashboard に戻す
function boardReturnPath(returnTo: string, basePath: string): string {
  return returnTo.startsWith(`${basePath}/?`) ? returnTo : `${basePath}/dashboard`
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
