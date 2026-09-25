import { existsSync, watch } from "node:fs"
import { join } from "node:path"
import { Hono, type Context } from "hono"
import { clientScript } from "./client-script"
import { styles } from "./css"
import { DashboardPage, USE_DEFAULT_ANSWER_PREFIX } from "./dashboard"
import { registerFontRoutes } from "./font"
import { BLANK, getPageData, type PageData } from "./page"
import { registerPwaRoutes } from "./pwa"
import { PROJECTS_AUTO_RELOAD, ProjectsPage, type ProjectSummary } from "./projects"
import { inboxQuestionAnchor, readInbox, workspaceBasePath } from "./inbox"
import { INBOX_PATH, InboxPage } from "./inbox-page"
import { notifyExpiringQuestions, notifyStaleIssues } from "./notify"
import {
  answerQuestion,
  cancelQuestion,
  ensureQuestionsDirectory,
  getQuestion,
  listQuestions,
  QuestionConflictError,
  undoAnswer,
  type Question,
} from "./questions"
import { readRepositoryState } from "./repository"
import { readSessionHealth } from "./sessions"
import {
  getComment,
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
import { livePageScript } from "./ui/live-page"
import { pageTitle } from "./ui/page-title"
import { renderDocument } from "./ui/render-document"
import { findWorkspace, listWorkspaces, stateDirectory, type Workspace } from "./workspaces"

export const DEFAULT_PORT = 47800

// /inbox が全ワークスペースの答え待ちの質問を読み直す間隔。全ワークスペースの変更を見張るのは重いので、しばらくおきに読む
const INBOX_POLL_MILLISECONDS = 30_000

// 板の絞り込みと見せ方 (答え待ちだけ・並べ方・まとめ方・終わった issue の見せ方)。フォームを送ったあとも同じ板へ戻すために持ち回る
const FILTER_KEYS = [
  "query",
  "status",
  "assignee",
  "label",
  "awaiting",
  "sort",
  "group",
  "completed",
  "view",
] as const

export type WorkspaceAppOptions = {
  // 1 つの yaru serve で複数のワークスペースを配るときの URL の接頭辞 (例: /p/app)。単独なら ""
  basePath?: string
  workspaceName?: string
}

export function createApp(store: Store, options: WorkspaceAppOptions = {}) {
  const app = new Hono()
  const basePath = options.basePath ?? ""
  // ワークスペースの中の失敗の画面は、一覧 (/) まで戻らずにそのワークスペースの板へ戻す
  const renderError = async (message: string) =>
    renderDocument(await styles(), <ErrorView message={message} backHref={`${basePath}/`} />, {
      title: pageTitle("Error"),
    })
  const boardTitle = (data: PageData) =>
    pageTitle(
      data.current?.id ? `#${data.current.id} ${data.current.title}` : undefined,
      options.workspaceName,
    )

  app.onError(async (err, c) => {
    const message = errorMessage(err)
    // 画面を描いた後に状態が変わっていたときは 409 Conflict にし、API ではいま保存されている質問も返す
    // https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10
    if (err instanceof QuestionConflictError) {
      if (c.req.path.startsWith("/api/")) {
        return c.json({ error: message, question: err.question }, 409)
      }
      return c.html(await renderError(message), 409)
    }
    const status = message.includes("not found") ? 404 : 400
    if (c.req.path.startsWith("/api/")) return c.json({ error: message }, status)
    return c.html(await renderError(message), status)
  })

  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404)
    return c.html(await renderError("not found"), 404)
  })

  app.get("/", async (c) => {
    const { data, status } = boardPageData(store, new URL(c.req.url), basePath)
    return c.html(
      renderDocument(await styles(), <BoardPage {...data} />, { title: boardTitle(data) }),
      status,
    )
  })

  // 失敗したフォームから戻ってきたときは、理由 (error)・どの質問か (q)・書きかけ (answer) を受け、そのカードに戻す
  // 答えた直後に戻ってきたときは、答えた質問 (answered) の取り消しの知らせを出す
  app.get("/dashboard", async (c) => {
    return c.html(
      await renderDashboard(store, {
        basePath,
        workspaceName: options.workspaceName,
        returned: {
          question: c.req.query("q") || undefined,
          error: c.req.query("error") || undefined,
          answer: c.req.query("answer") || undefined,
        },
        answered: findQuestion(store, c.req.query("answered")),
      }),
    )
  })

  // フォームの POST の結果は、成功しても失敗しても 303 See Other で GET の画面へ戻す
  // POST の結果を直接描くと、画面の自動の読み直しやブラウザの再読み込みが POST を送り直し、行き止まりの画面が残るため
  // 失敗したときは、理由 (error)、どの質問か (q)、書きかけの答え (answer) を戻り先の URL に載せ、カードで答え直せるようにする
  // https://www.rfc-editor.org/rfc/rfc9110#section-15.4.4
  app.post("/questions/:id/answer", async (c) => {
    const body = await c.req.parseBody()
    const id = c.req.param("id")
    const returnTo = formReturnPath(str(body.returnTo), basePath)
    const fragment = questionFragment(returnTo, id, options.workspaceName)
    const draft = str(body.body)
    const workspace = inboxWorkspace(returnTo, options.workspaceName)
    try {
      const answer =
        str(body.useDefault) === "1"
          ? `${USE_DEFAULT_ANSWER_PREFIX}${getQuestion(store, id).defaultAction ?? ""}`
          : draft
      answerQuestion(store, id, {
        body: answer,
        expectedStatus: str(body.expectedStatus) || undefined,
        force: str(body.force) === "1",
      })
    } catch (err) {
      return c.redirect(
        redirectPath(
          returnTo,
          { error: errorMessage(err), q: id, workspace, answer: draftForRedirect(draft) },
          fragment,
        ),
        303,
      )
    }
    // 答えたカードは答え待ちから外れるので、フォームが持ってきた次のカード (next) へ戻し、答えた質問 (answered) の取り消しを出す
    // 板 (issue 画面) は取り消しの知らせを持たないので、answered は dashboard と /inbox に戻るときだけ載せる
    return c.redirect(
      redirectPath(
        returnTo,
        showsAnsweredToast(returnTo, basePath) ? { answered: id, workspace } : {},
        nextFragment(str(body.next)) ?? fragment,
      ),
      303,
    )
  })

  // 答えたばかりの答えを取り消し、答え待ちに戻す (questions.ts の undoAnswer)
  // 取り消した答えは消えるので、書きかけ (answer) として戻り先のカードに戻し、直して答え直せるようにする
  app.post("/questions/:id/undo", async (c) => {
    const body = await c.req.parseBody()
    const id = c.req.param("id")
    const returnTo = formReturnPath(str(body.returnTo), basePath)
    const fragment = questionFragment(returnTo, id, options.workspaceName)
    const workspace = inboxWorkspace(returnTo, options.workspaceName)
    let answer = ""
    try {
      const question = getQuestion(store, id)
      answer = typedAnswer(question)
      undoAnswer(store, id, { answeredAt: str(body.answeredAt) || undefined })
    } catch (err) {
      return c.redirect(
        redirectPath(returnTo, { error: errorMessage(err), q: id, workspace }, fragment),
        303,
      )
    }
    return c.redirect(
      redirectPath(returnTo, { q: id, workspace, answer: draftForRedirect(answer) }, fragment),
      303,
    )
  })

  app.post("/questions/:id/cancel", async (c) => {
    const body = await c.req.parseBody()
    const id = c.req.param("id")
    const returnTo = formReturnPath(str(body.returnTo), basePath)
    const fragment = questionFragment(returnTo, id, options.workspaceName)
    try {
      cancelQuestion(store, id)
    } catch (err) {
      return c.redirect(
        redirectPath(
          returnTo,
          {
            error: errorMessage(err),
            q: id,
            workspace: inboxWorkspace(returnTo, options.workspaceName),
          },
          fragment,
        ),
        303,
      )
    }
    return c.redirect(redirectPath(returnTo, {}, nextFragment(str(body.next)) ?? fragment), 303)
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
    const input = await c.req.json<{ body?: string; expectedStatus?: string; force?: boolean }>()
    return c.json(
      answerQuestion(store, c.req.param("id"), {
        body: input.body,
        expectedStatus: input.expectedStatus,
        force: input.force === true,
      }),
    )
  })

  app.post("/api/questions/:id/cancel", (c) => {
    return c.json(cancelQuestion(store, c.req.param("id")))
  })

  app.get("/assets/app.js", serveClientScript)
  registerPwaRoutes(app)
  registerFontRoutes(app)

  app.post("/issues", async (c) => {
    const body = await c.req.parseBody()
    const filters = {
      query: c.req.query("query") || str(body.query),
      view: c.req.query("view") || str(body.view),
      label: c.req.query("label") || str(body.label),
      status: c.req.query("status") || str(body.filter_status),
      assignee: c.req.query("assignee") || str(body.filter_assignee),
      awaiting: c.req.query("awaiting") || str(body.awaiting),
      sort: c.req.query("sort") || str(body.sort),
      group: c.req.query("group") || str(body.group),
      completed: c.req.query("completed") || str(body.completed),
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
      // 書きかけの issue を失わないよう、ここだけは戻らずにその場で描き直す (新しい issue の下書きは URL に載せきれないため)
      // 板の他の部分は同じ絞り込みの GET と同じにするため、板の URL を組み立てて getPageData を通す
      const boardUrl = new URL(hrefFrom(filters, ""), c.req.url)
      if (draft.id) boardUrl.searchParams.set("id", draft.id)
      const { data } = boardPageData(store, boardUrl, basePath)
      return c.html(
        renderDocument(
          await styles(),
          <BoardPage
            {...data}
            current={draft}
            comments={draft.id ? listComments(store, { issue: draft.id }) : []}
            error={errorMessage(err)}
          />,
          { title: boardTitle(data) },
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

  // 消えた issue を開こうとしたときも、板を描き直せるよう page のデータを添えたまま 404 を返す
  app.get("/api/page", (c) => {
    const { data, status } = boardPageData(store, new URL(c.req.url), basePath)
    return c.json(data, status)
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

  // 失敗したときは、理由 (error) と書きかけのコメント (comment) を載せて issue へ戻す。理由は /questions/:id/answer と同じ
  app.post("/comments", async (c) => {
    const body = await c.req.parseBody()
    const params = new URLSearchParams()
    for (const key of FILTER_KEYS) {
      const value = c.req.query(key) || str(body[key])
      if (value) params.set(key, value)
    }
    const draft = str(body.body)
    try {
      const saved = saveComment(store, {
        issue: str(body.issue) || undefined,
        parent: str(body.parent) || undefined,
        body: draft,
      })
      params.set("id", saved.issue)
    } catch (err) {
      const issue = str(body.issue) || commentIssue(store, str(body.parent))
      if (issue) params.set("id", issue)
      params.set("error", errorMessage(err))
      const comment = draftForRedirect(draft)
      if (comment) params.set("comment", comment)
    }
    return c.redirect(`${basePath}/?${params.toString()}`, 303)
  })

  return app
}

async function renderDashboard(
  store: Store,
  options: {
    basePath: string
    workspaceName?: string
    returned: { question?: string; error?: string; answer?: string }
    answered: Question | null
  },
): Promise<string> {
  const now = new Date()
  return renderDocument(
    await styles(),
    <DashboardPage
      questions={listQuestions(store, {}, now)}
      issues={listIssues(store, {}, now)}
      now={now}
      sessionHealth={readSessionHealth(store.root, { now })}
      repository={readRepositoryState(store.root)}
      basePath={options.basePath}
      workspaceName={options.workspaceName}
      returned={options.returned}
      answered={options.answered}
    />,
    {
      title: pageTitle("Dashboard", options.workspaceName),
      script: livePageScript({
        watch: {
          type: "events",
          eventsUrl: `${options.basePath}/events`,
          questionsUrl: `${options.basePath}/api/questions`,
        },
        draftStorageKey: `yaru.drafts:${options.basePath}/dashboard`,
      }),
    },
  )
}

// 戻り先の URL の answered= の質問。消えていたら (別の場所で消されたなど) 知らせを出さない
function findQuestion(store: Store, id: string | undefined): Question | null {
  if (!id) return null
  try {
    return getQuestion(store, id)
  } catch {
    return null
  }
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
    return c.html(
      renderDocument(await styles(), <ErrorView message="not found" />, {
        title: pageTitle("Error"),
      }),
      404,
    )
  })

  app.get("/", async (c) => {
    return c.html(await renderProjects(directory))
  })

  // 失敗したフォームから戻ってきたときは、どのワークスペースの (workspace) どの質問か (q) で、そのカードに理由と書きかけを戻す
  // 答えた直後に戻ってきたときは、そのワークスペースの答えた質問 (answered) の取り消しの知らせを出す
  app.get(INBOX_PATH, async (c) => {
    const now = new Date()
    const workspaceSlug = c.req.query("workspace") || undefined
    const answeredId = c.req.query("answered") || undefined
    const answeredWorkspace =
      answeredId && workspaceSlug ? findWorkspace(workspaceSlug, directory) : undefined
    const answeredQuestion = answeredWorkspace
      ? findQuestion(open(answeredWorkspace.root), answeredId)
      : null
    return c.html(
      renderDocument(
        await styles(),
        <InboxPage
          inbox={readInbox(directory, now)}
          now={now}
          returned={{
            workspace: workspaceSlug,
            question: c.req.query("q") || undefined,
            error: c.req.query("error") || undefined,
            answer: c.req.query("answer") || undefined,
          }}
          answered={
            answeredWorkspace && answeredQuestion
              ? {
                  question: answeredQuestion,
                  basePath: workspaceBasePath(answeredWorkspace.slug),
                }
              : null
          }
        />,
        {
          title: pageTitle("Inbox"),
          script: livePageScript({
            watch: {
              type: "poll",
              inboxUrl: "/api/inbox",
              intervalMilliseconds: INBOX_POLL_MILLISECONDS,
            },
            draftStorageKey: `yaru.drafts:${INBOX_PATH}`,
          }),
        },
      ),
    )
  })

  app.get("/assets/app.js", serveClientScript)
  registerPwaRoutes(app)
  registerFontRoutes(app)

  app.get("/api/inbox", (c) => {
    return c.json(readInbox(directory, new Date()))
  })

  app.get("/p/:slug", (c) => c.redirect(`${workspaceBasePath(c.req.param("slug"))}/`))

  app.all("/p/:slug/*", async (c) => {
    const workspace = findWorkspace(c.req.param("slug"), directory)
    if (!workspace) {
      return c.html(
        renderDocument(
          await styles(),
          <ErrorView message={`workspace not found: ${c.req.param("slug")}`} />,
          { title: pageTitle("Error") },
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
  return renderDocument(await styles(), <ProjectsPage projects={projects} now={now} />, {
    title: pageTitle(),
    script: PROJECTS_AUTO_RELOAD,
  })
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
    watchNotifications(stateDirectory(), `http://127.0.0.1:${server.port}`)
  } catch (err) {
    if (isAddrInUse(err)) {
      console.log(`yaru  already running  http://127.0.0.1:${port}`)
      return
    }
    throw err
  }
}

const NOTIFICATION_CHECK_INTERVAL_MILLISECONDS = 60_000

// 質問の期限が近いことと、issue が止まっていることは、何かを書き込んだ瞬間ではなく時間が経って起きるので、serve が毎分見回って知らせる
// 前の見回りが通知コマンドを待っている間は次を始めない
function watchNotifications(directory: string, baseUrl: string): void {
  let running = false
  const check = async () => {
    if (running) return
    running = true
    try {
      const now = new Date()
      const warnings = [
        ...(await notifyExpiringQuestions(directory, now, baseUrl)),
        ...(await notifyStaleIssues(directory, now, baseUrl)),
      ]
      for (const warning of warnings) console.error(warning)
    } catch (err) {
      console.error(`notification check failed: ${errorMessage(err)}`)
    } finally {
      running = false
    }
  }
  void check()
  setInterval(check, NOTIFICATION_CHECK_INTERVAL_MILLISECONDS)
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

// フォームの後の戻り先は、このワークスペースの板と dashboard と、全ワークスペースの受信箱 (/inbox) だけに限る
// 外部の URL や別のワークスペースへ飛ばされないよう、それ以外は dashboard に戻す
const REDIRECT_BASE = "http://yaru.invalid"

function formReturnPath(returnTo: string, basePath: string): string {
  const fallback = `${basePath}/dashboard`
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\")) {
    return fallback
  }
  let url: URL
  try {
    url = new URL(returnTo, REDIRECT_BASE)
  } catch {
    return fallback
  }
  if (url.origin !== REDIRECT_BASE) return fallback
  if (![`${basePath}/`, `${basePath}/dashboard`, "/inbox"].includes(url.pathname)) return fallback
  return `${url.pathname}${url.search}`
}

// 戻り先に元からある query を壊さないよう、文字列をつながず URL として足す。空の値は載せない
function redirectPath(path: string, params: Record<string, string>, fragment: string): string {
  const url = new URL(path, REDIRECT_BASE)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }
  url.hash = fragment
  return `${url.pathname}${url.search}${url.hash}`
}

// 板の深いリンク (?id=) の issue が無いとき、getPageData は板を描けるよう current を空にして理由を error に入れる
// 状態は 404 にし、リンクが切れていることは機械にも分かるようにする
// 失敗したフォームから戻ってきたときは ?error= の理由を優先して出す
function boardPageData(
  store: Store,
  url: URL,
  basePath: string,
): { data: PageData; status: 200 | 404 } {
  const data = getPageData(store, url, basePath)
  const id = url.searchParams.get("id")
  const missing = id !== null && data.error === `issue not found: ${id}`
  const returnedError = url.searchParams.get("error") || undefined
  return { data: { ...data, error: returnedError ?? data.error }, status: missing ? 404 : 200 }
}

// /inbox は全ワークスペースの質問を並べ、質問の番号はワークスペースごとなので、戻り先が /inbox ならワークスペースの名前を添える
function isInbox(returnTo: string): boolean {
  return new URL(returnTo, REDIRECT_BASE).pathname === "/inbox"
}

function questionFragment(returnTo: string, id: string, workspaceName: string | undefined): string {
  return isInbox(returnTo) && workspaceName ? inboxQuestionAnchor(workspaceName, id) : `q-${id}`
}

function inboxWorkspace(returnTo: string, workspaceName: string | undefined): string {
  return isInbox(returnTo) && workspaceName ? workspaceName : ""
}

// 取り消した答えのうち、人が回答欄に書いたもの。Use default と選択肢のボタンの答えは書いたものではないので、回答欄に戻さない
function typedAnswer(question: Question): string {
  const answer = question.answer ?? ""
  if (answer.startsWith(USE_DEFAULT_ANSWER_PREFIX) || question.options.includes(answer)) return ""
  return answer
}

// 答えた直後の取り消しの知らせ (AnsweredToast) を出す画面か
function showsAnsweredToast(returnTo: string, basePath: string): boolean {
  const pathname = new URL(returnTo, REDIRECT_BASE).pathname
  return pathname === `${basePath}/dashboard` || pathname === INBOX_PATH
}

// 答えたあとに開く次のカードの id (フォームの next)。fragment に載せるので、カードの id の形 (q-<名前>-<番号>) だけを通す
// 形の違うものは使わず、答えたカードの id に戻す
const NEXT_FRAGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/

function nextFragment(next: string): string | undefined {
  return NEXT_FRAGMENT_PATTERN.test(next) ? next : undefined
}

// 書きかけの文を戻り先の URL に載せるのは、その URL がサーバーの受け取れる長さに収まるときだけにする
// Bun.serve は request line とヘッダーの合計がおよそ 16KB を超えると 431 を返し、日本語は 1 文字が 9 文字に符号化されるため
// 載せられないときは理由だけを返す。書きかけの文はブラウザの「戻る」でフォームに残っている
// https://www.rfc-editor.org/rfc/rfc6585#section-5
const REDIRECT_DRAFT_MAX_ENCODED_LENGTH = 8000

function draftForRedirect(draft: string): string {
  return encodeURIComponent(draft).length <= REDIRECT_DRAFT_MAX_ENCODED_LENGTH ? draft : ""
}

// 返信のフォームには issue が無いので、親のコメントから戻り先の issue を探す
function commentIssue(store: Store, parent: string): string {
  if (!parent) return ""
  try {
    return getComment(store, parent).issue
  } catch {
    return ""
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
