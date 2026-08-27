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

export function pageHref(query: string, id?: string): string {
  const p = new URLSearchParams()
  if (query) p.set("query", query)
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
      <body class="min-h-screen bg-paper font-sans text-sm leading-normal text-ink">
        {children}
      </body>
    </html>
  )
}

export function BoardPage({
  issues,
  query,
  current,
}: {
  issues: Issue[]
  query: string
  current: Issue | null
}) {
  return (
    <>
      <header class="flex items-center gap-3 border-b border-line px-[18px] py-3.5">
        <b class="text-base tracking-[0.04em]">yaru</b>
        <form method="get" action="/" class="flex flex-1 items-center gap-3">
          <input
            id="q"
            type="search"
            name="query"
            value={query}
            placeholder="search"
            autocomplete="off"
            class="max-w-[280px] flex-1 rounded-md border border-line bg-card px-2.5 py-[7px] font-sans text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </form>
        <a
          href={pageHref(query, "new")}
          class="rounded-md bg-accent px-3 py-[7px] text-white no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          new
        </a>
      </header>
      <Board issues={issues} query={query} />
      {current ? <Drawer issue={current} query={query} /> : null}
      <script dangerouslySetInnerHTML={{ __html: SEARCH }} />
    </>
  )
}

function Board({ issues, query }: { issues: Issue[]; query: string }) {
  return (
    <main
      id="board"
      class="grid min-h-[calc(100vh-56px)] grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 p-3.5"
    >
      {columns(issues).map((status) => {
        const items = issues.filter((issue) => issue.status === status)
        return (
          <section class="min-h-[200px] rounded-[10px] border border-line bg-white/40 p-2.5">
            <h2 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              {labelStatus(status)} {items.length}
            </h2>
            {items.map((issue) => (
              <a
                href={pageHref(query, issue.id)}
                class="mb-2 block rounded-lg border border-line bg-card px-3 py-2.5 text-ink no-underline hover:border-[#d6ccc0]"
              >
                <div class="text-[11px] text-muted">{issue.id}</div>
                <div class="mt-0.5 font-medium">{issue.title}</div>
                <div class="mt-1.5 text-xs text-muted">
                  {[issue.assignee, issue.labels.join(", ")].filter(Boolean).join(" · ")}
                </div>
              </a>
            ))}
          </section>
        )
      })}
    </main>
  )
}

function Drawer({ issue, query }: { issue: Issue; query: string }) {
  const statuses = columns([issue])
  return (
    <aside class="fixed top-0 right-0 flex h-full w-full max-w-[420px] flex-col gap-2 border-l border-line bg-card p-[18px]">
      <form method="post" action="/issues" class="flex h-full flex-col gap-2">
        {query ? <input type="hidden" name="query" value={query} /> : null}
        {issue.id ? <input type="hidden" name="id" value={issue.id} /> : null}
        <div class="text-[11px] text-muted">{issue.id || "new"}</div>
        <input
          name="title"
          value={issue.title}
          placeholder="title"
          class="w-full rounded-md border border-line bg-white px-2 py-2 font-sans text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <div class="flex gap-2">
          <select
            name="status"
            class="min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-2 font-sans text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
            placeholder="assignee"
            class="min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-2 font-sans text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </div>
        <input
          name="labels"
          value={issue.labels.join(", ")}
          placeholder="labels, comma separated"
          class="w-full rounded-md border border-line bg-white px-2 py-2 font-sans text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <textarea
          name="body"
          placeholder="body"
          class="min-h-[220px] w-full flex-1 resize-y rounded-md border border-line bg-white px-2 py-2 font-sans text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {issue.body}
        </textarea>
        <div class="flex gap-2">
          <a
            href={pageHref(query)}
            class="flex-1 rounded-md border border-line bg-transparent px-3 py-[7px] text-center text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            close
          </a>
          <button
            type="submit"
            class="flex-1 cursor-pointer rounded-md border-0 bg-accent px-3 py-[7px] font-sans text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            save
          </button>
        </div>
      </form>
    </aside>
  )
}

export function ErrorView({ message }: { message: string }) {
  return (
    <main class="p-4">
      <p class="text-accent">{message}</p>
      <a href="/" class="mt-2 inline-block text-ink underline">
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
  return status.replaceAll("_", " ")
}

const SEARCH = `const q = document.getElementById("q")
if (q) q.addEventListener("input", () => {
  clearTimeout(window.__yaru)
  window.__yaru = setTimeout(async () => {
    const value = q.value.trim()
    const url = value ? "/?query=" + encodeURIComponent(value) : "/"
    const res = await fetch(url)
    const html = await res.text()
    const doc = new DOMParser().parseFromString(html, "text/html")
    const next = doc.getElementById("board")
    const board = document.getElementById("board")
    if (next && board) board.replaceWith(next)
    history.replaceState(null, "", url)
  }, 120)
})
`
