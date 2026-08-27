import type { PropsWithChildren } from "hono/jsx"
import { STATUSES, type Issue } from "./store"

export const BLANK: Issue = {
  id: "",
  title: "",
  status: "todo",
  assignee: null,
  labels: [],
  createdAt: "",
  updatedAt: "",
  body: "",
}

export type PageFilters = {
  query?: string
  status?: string
  assignee?: string
  label?: string
  view?: "board" | "list"
}

export type BoardPageProps = {
  issues: Issue[]
  query: string
  current: Issue | null
  status?: string
  assignee?: string
  label?: string
  view?: "board" | "list"
  error?: string
}

export function pageHref(filters: PageFilters, id?: string): string {
  const p = new URLSearchParams()
  if (filters.query) p.set("query", filters.query)
  if (filters.status) p.set("status", filters.status)
  if (filters.assignee) p.set("assignee", filters.assignee)
  if (filters.label) p.set("label", filters.label)
  if (filters.view && filters.view !== "board") p.set("view", filters.view)
  if (id) p.set("id", id)
  const s = p.toString()
  return s ? `/?${s}` : "/"
}

export function Document({ css, children }: PropsWithChildren<{ css: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>yaru</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body class="min-h-screen bg-canvas font-sans text-sm leading-normal text-ink antialiased">
        {children}
      </body>
    </html>
  )
}

export function BoardPage({
  issues,
  query,
  current,
  status,
  assignee,
  label,
  view = "board",
  error,
}: BoardPageProps) {
  const ctx: PageFilters = { query, status, assignee, label, view }
  return (
    <>
      <Nav ctx={ctx} />
      <StatusFilters ctx={ctx} />
      {view === "list" ? (
        <IssueList issues={issues} ctx={ctx} />
      ) : (
        <Board issues={issues} ctx={ctx} />
      )}
      {current ? <Drawer issue={current} ctx={ctx} error={error} /> : null}
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </>
  )
}

function Nav({ ctx }: { ctx: PageFilters }) {
  const list = ctx.view === "list"
  const tab = (active: boolean) =>
    active
      ? "rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink no-underline sm:px-3.5 sm:py-1.5 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
      : "rounded-full bg-transparent px-2.5 py-1 text-xs font-medium text-ink-subtle no-underline hover:text-ink sm:px-3.5 sm:py-1.5 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
  return (
    <header class="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2 sm:h-14 sm:flex-nowrap sm:gap-3 sm:py-0">
      <a href="/" class="shrink-0 text-[15px] font-medium tracking-tight text-primary no-underline">
        yaru
      </a>
      <form
        method="get"
        action="/"
        class="order-last w-full min-w-0 sm:order-none sm:max-w-[280px] sm:flex-1"
      >
        {ctx.status ? <input type="hidden" name="status" value={ctx.status} /> : null}
        {ctx.assignee ? <input type="hidden" name="assignee" value={ctx.assignee} /> : null}
        {ctx.label ? <input type="hidden" name="label" value={ctx.label} /> : null}
        {list ? <input type="hidden" name="view" value="list" /> : null}
        <div class="relative w-full">
          <input
            id="q"
            type="search"
            name="query"
            value={ctx.query ?? ""}
            placeholder="Search"
            autocomplete="off"
            class="h-8 w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 pr-8 font-sans text-sm text-ink placeholder:text-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
          />
          <span class="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-sm border border-hairline px-1 text-[10px] text-ink-tertiary sm:inline">
            /
          </span>
        </div>
      </form>
      <div class="ml-auto flex shrink-0 rounded-full border border-hairline p-0.5 sm:ml-0">
        <a href={pageHref({ ...ctx, view: "board" })} class={tab(!list)}>
          Board
        </a>
        <a href={pageHref({ ...ctx, view: "list" })} class={tab(list)}>
          List
        </a>
      </div>
      <a
        id="new-issue"
        href={pageHref(ctx, "new")}
        class="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary no-underline hover:bg-primary-hover active:bg-primary-focus sm:px-3.5 sm:py-2 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
      >
        New
        <span class="hidden sm:inline">issue</span>
        <span class="hidden text-[11px] font-normal text-on-primary/60 sm:inline">C</span>
      </a>
    </header>
  )
}

function StatusFilters({ ctx }: { ctx: PageFilters }) {
  const pill = (active: boolean) =>
    active
      ? "rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-medium text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
      : "rounded-full bg-canvas px-3.5 py-1.5 text-sm font-medium text-ink-subtle no-underline hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
  return (
    <div class="flex items-center gap-1 overflow-x-auto border-b border-hairline px-4 py-2">
      <a href={pageHref({ ...ctx, status: undefined })} class={pill(!ctx.status)}>
        All
      </a>
      {STATUSES.map((status) => {
        const active = ctx.status === status
        return (
          <a href={pageHref({ ...ctx, status: active ? undefined : status })} class={pill(active)}>
            {labelStatus(status)}
          </a>
        )
      })}
    </div>
  )
}

function Board({ issues, ctx }: { issues: Issue[]; ctx: PageFilters }) {
  return (
    <main id="board" class="flex min-h-[calc(100vh-6.5rem)] gap-3 overflow-x-auto p-4">
      {columns(issues).map((status) => {
        const items = issues.filter((issue) => issue.status === status)
        return (
          <section
            data-status={status}
            class="flex min-h-[calc(100vh-8rem)] min-w-[220px] flex-1 flex-col rounded-lg p-2 data-[over]:bg-surface-2"
          >
            <div class="mb-2 flex items-center gap-2 px-1">
              <StatusDot status={status} />
              <h2 class="text-xs font-medium text-ink-subtle">{labelStatus(status)}</h2>
              <span class="text-xs text-ink-tertiary">{items.length}</span>
            </div>
            {items.map((issue) => (
              <IssueCard issue={issue} ctx={ctx} />
            ))}
          </section>
        )
      })}
    </main>
  )
}

function IssueCard({ issue, ctx }: { issue: Issue; ctx: PageFilters }) {
  return (
    <a
      href={pageHref(ctx, issue.id)}
      data-id={issue.id}
      data-status={issue.status}
      draggable="true"
      class="mb-1.5 block cursor-pointer rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-ink no-underline select-none hover:bg-surface-2 aria-selected:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
    >
      <div class="font-mono text-[13px] text-ink-tertiary">{issue.id}</div>
      <div class="mt-0.5 text-sm font-medium text-ink">{issue.title}</div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-ink-subtle">
        {issue.assignee ? <span>{issue.assignee}</span> : null}
        {issue.labels.map((label) => (
          <span class="rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-ink-subtle">
            {label}
          </span>
        ))}
      </div>
    </a>
  )
}

function IssueList({ issues, ctx }: { issues: Issue[]; ctx: PageFilters }) {
  return (
    <main id="board" class="min-h-[calc(100vh-6.5rem)]">
      <div class="flex items-center gap-3 border-b border-hairline px-4 py-2 text-xs text-ink-tertiary">
        <span class="w-20 shrink-0">id</span>
        <span class="min-w-0 flex-1">title</span>
        <span class="w-32 shrink-0">status</span>
        <span class="w-28 shrink-0">assignee</span>
        <span class="w-40 shrink-0">labels</span>
      </div>
      {issues.map((issue) => (
        <a
          href={pageHref(ctx, issue.id)}
          data-id={issue.id}
          data-status={issue.status}
          class="flex items-center gap-3 border-b border-hairline px-4 py-2 text-ink no-underline hover:bg-surface-1 aria-selected:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
        >
          <span class="w-20 shrink-0 font-mono text-[13px] text-ink-tertiary">{issue.id}</span>
          <span class="min-w-0 flex-1 truncate font-medium">{issue.title}</span>
          <span class="w-32 shrink-0">
            <span class="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
              <StatusDot status={issue.status} />
              {labelStatus(issue.status)}
            </span>
          </span>
          <span class="w-28 shrink-0 truncate text-xs text-ink-subtle">{issue.assignee ?? ""}</span>
          <span class="w-40 shrink-0 truncate text-xs text-ink-subtle">
            {issue.labels.join(", ")}
          </span>
        </a>
      ))}
    </main>
  )
}

function Drawer({ issue, ctx, error }: { issue: Issue; ctx: PageFilters; error?: string }) {
  const statuses = columns([issue])
  return (
    <aside class="fixed top-14 right-0 z-20 flex h-[calc(100vh-3.5rem)] w-full max-w-[420px] flex-col gap-3 border-l border-hairline bg-surface-1 p-4">
      <form method="post" action="/issues" class="flex h-full flex-col gap-3">
        {error ? (
          <p class="rounded-md border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink">
            {error}
          </p>
        ) : null}
        {ctx.query ? <input type="hidden" name="query" value={ctx.query} /> : null}
        {ctx.view && ctx.view !== "board" ? (
          <input type="hidden" name="view" value={ctx.view} />
        ) : null}
        {ctx.status ? <input type="hidden" name="filter_status" value={ctx.status} /> : null}
        {ctx.assignee ? <input type="hidden" name="filter_assignee" value={ctx.assignee} /> : null}
        {ctx.label ? <input type="hidden" name="label" value={ctx.label} /> : null}
        {issue.id ? <input type="hidden" name="id" value={issue.id} /> : null}
        <div class="font-mono text-[13px] text-ink-tertiary">{issue.id || "New issue"}</div>
        <input
          name="title"
          value={issue.title}
          placeholder="Issue title"
          autofocus={!issue.id}
          class="w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
        />
        <div class="flex gap-2">
          <select
            name="status"
            class="min-w-0 flex-1 rounded-md border border-hairline bg-surface-1 px-3 py-2 font-sans text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
          >
            {statuses.map((status) => (
              <option value={status} selected={status === issue.status}>
                {labelStatus(status)}
              </option>
            ))}
          </select>
          <input
            name="assignee"
            value={issue.assignee ?? ""}
            placeholder="Assignee"
            class="min-w-0 flex-1 rounded-md border border-hairline bg-surface-1 px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
          />
        </div>
        <input
          name="labels"
          value={issue.labels.join(", ")}
          placeholder="Labels, comma separated"
          class="w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
        />
        <textarea
          name="body"
          placeholder="Write a description…"
          class="min-h-[220px] w-full flex-1 resize-y rounded-md border border-hairline bg-surface-1 px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
        >
          {issue.body}
        </textarea>
        <div class="flex gap-2">
          <a
            id="drawer-close"
            href={pageHref(ctx)}
            class="flex-1 rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-center text-sm font-medium text-ink no-underline hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
          >
            Close
          </a>
          <button
            type="submit"
            class="flex-1 cursor-pointer rounded-md border-0 bg-primary px-3.5 py-2 font-sans text-sm font-medium text-on-primary hover:bg-primary-hover active:bg-primary-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
          >
            Save
          </button>
        </div>
      </form>
    </aside>
  )
}

function StatusDot({ status }: { status: string }) {
  if (status === "todo") return <span class="size-2 shrink-0 rounded-full bg-ink-muted" />
  if (status === "in_progress") return <span class="size-2 shrink-0 rounded-full bg-primary" />
  if (status === "done") return <span class="size-2 shrink-0 rounded-full bg-semantic-success" />
  return <span class="size-2 shrink-0 rounded-full bg-ink-tertiary" />
}

export function ErrorView({ message }: { message: string }) {
  return (
    <main class="p-8">
      <p class="text-ink-muted">{message}</p>
      <a
        href="/"
        class="mt-2 inline-block text-primary no-underline hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
      >
        back
      </a>
    </main>
  )
}

function columns(issues: Issue[]): string[] {
  const extra: string[] = []
  for (const issue of issues) {
    if (!(STATUSES as readonly string[]).includes(issue.status) && !extra.includes(issue.status))
      extra.push(issue.status)
  }
  return [...STATUSES, ...extra]
}

function labelStatus(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

const SCRIPT = `(() => {
  const q = document.getElementById("q")
  const typing = (el) => {
    if (!el || !el.tagName) return false
    const tag = el.tagName
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
  }

  if (q) {
    let timer
    let seq = 0
    q.addEventListener("input", () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const n = ++seq
        const form = q.form
        const params = new URLSearchParams(new FormData(form))
        if (!params.get("query")) params.delete("query")
        const url = params.toString() ? "/?" + params.toString() : "/"
        const res = await fetch(url)
        const html = await res.text()
        if (n !== seq) return
        const doc = new DOMParser().parseFromString(html, "text/html")
        const next = doc.getElementById("board")
        const board = document.getElementById("board")
        if (next && board) board.replaceWith(next)
        history.replaceState(null, "", url)
      }, 120)
    })
  }

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === "Escape") {
      if (typing(e.target) && q && e.target === q) {
        q.blur()
        return
      }
      const close = document.getElementById("drawer-close")
      if (close) {
        location.href = close.href
        return
      }
      const url = new URL(location.href)
      url.searchParams.delete("id")
      const s = url.searchParams.toString()
      location.href = s ? "/?" + s : "/"
      return
    }
    if (typing(e.target)) return
    if (e.key === "/") {
      e.preventDefault()
      if (q) q.focus()
      return
    }
    if (e.key === "c" || e.key === "n") {
      const link = document.getElementById("new-issue")
      if (link) location.href = link.href
      return
    }
    if (e.key === "j" || e.key === "k" || e.key === "Enter") {
      const items = [...document.querySelectorAll("#board [data-id]")]
      if (!items.length) return
      const i = items.findIndex((el) => el.getAttribute("aria-selected") === "true")
      if (e.key === "Enter") {
        const cur = i >= 0 ? items[i] : null
        if (cur && cur.href) location.href = cur.href
        return
      }
      e.preventDefault()
      let next = e.key === "j" ? (i < 0 ? 0 : i + 1) : (i < 0 ? items.length - 1 : i - 1)
      if (next >= items.length) next = 0
      if (next < 0) next = items.length - 1
      for (const el of items) el.removeAttribute("aria-selected")
      items[next].setAttribute("aria-selected", "true")
      items[next].scrollIntoView({ block: "nearest" })
    }
  })

  let dragId = ""
  document.addEventListener("dragstart", (e) => {
    const card = e.target.closest && e.target.closest("#board [data-id][draggable]")
    if (!card) return
    dragId = card.getAttribute("data-id") || ""
    e.dataTransfer.setData("text/plain", dragId)
    e.dataTransfer.effectAllowed = "move"
  })
  document.addEventListener("dragend", () => {
    dragId = ""
    for (const el of document.querySelectorAll("[data-over]")) el.removeAttribute("data-over")
  })
  document.addEventListener("dragover", (e) => {
    const col = e.target.closest && e.target.closest("section[data-status]")
    if (!col) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    for (const el of document.querySelectorAll("[data-over]")) {
      if (el !== col) el.removeAttribute("data-over")
    }
    col.setAttribute("data-over", "")
  })
  document.addEventListener("dragleave", (e) => {
    const col = e.target.closest && e.target.closest("section[data-status]")
    if (!col) return
    if (!e.relatedTarget || !col.contains(e.relatedTarget)) col.removeAttribute("data-over")
  })
  document.addEventListener("drop", async (e) => {
    const col = e.target.closest && e.target.closest("section[data-status]")
    const id = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || dragId
    if (!col || !id) return
    e.preventDefault()
    col.removeAttribute("data-over")
    const status = col.getAttribute("data-status") || ""
    const from = document.querySelector('#board [data-id="' + CSS.escape(id) + '"]')
    if (from && from.getAttribute("data-status") === status) return
    const body = new URLSearchParams()
    body.set("id", id)
    body.set("status", status)
    if (q && q.form) {
      const params = new URLSearchParams(new FormData(q.form))
      for (const key of ["query", "view", "assignee", "label"]) {
        const v = params.get(key)
        if (v) body.set(key, v)
      }
      const st = params.get("status")
      if (st) body.set("filter_status", st)
    }
    const res = await fetch("/issues", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      redirect: "follow",
    })
    if (res.redirected) location.assign(res.url)
    else location.reload()
  })

  let liveSeq = 0
  let liveTimer
  const live = new EventSource("/events")
  live.onmessage = () => {
    clearTimeout(liveTimer)
    liveTimer = setTimeout(async () => {
      const n = ++liveSeq
      const res = await fetch(location.pathname + location.search)
      const html = await res.text()
      if (n !== liveSeq) return
      const doc = new DOMParser().parseFromString(html, "text/html")
      const nextBoard = doc.getElementById("board")
      const board = document.getElementById("board")
      if (nextBoard && board) board.replaceWith(nextBoard)
      const nextAside = doc.querySelector("aside")
      const aside = document.querySelector("aside")
      if (aside && nextAside) aside.replaceWith(nextAside)
      else if (aside && !nextAside) aside.remove()
      else if (!aside && nextAside) document.getElementById("board")?.after(nextAside)
    }, 80)
  }
})()
`
