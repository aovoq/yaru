import type { PropsWithChildren } from "hono/jsx"
import { isOverdue, PRIORITIES, STATUSES, type Issue, type Priority } from "./store"

export const BLANK: Issue = {
  id: "",
  title: "",
  status: "todo",
  assignee: null,
  labels: [],
  dueDate: null,
  priority: null,
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
  all: Issue[]
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

function newHref(ctx: PageFilters, status?: string): string {
  const base = pageHref(ctx, "new")
  if (!status) return base
  return `${base}${base.includes("?") ? "&" : "?"}new_status=${encodeURIComponent(status)}`
}

export function Document({ css, children }: PropsWithChildren<{ css: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>yaru</title>
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%235e6ad2'/%3E%3Ctext x='16' y='22' font-family='sans-serif' font-size='17' font-weight='600' text-anchor='middle' fill='white'%3Ey%3C/text%3E%3C/svg%3E"
        />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body class="h-screen overflow-hidden bg-canvas font-sans text-[13px] leading-normal text-ink antialiased scheme-dark">
        {children}
      </body>
    </html>
  )
}

export function BoardPage({
  issues,
  all,
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
      <div class="flex h-screen">
        <Sidebar all={all} ctx={ctx} />
        <div class="flex min-w-0 flex-1 flex-col">
          <Header ctx={ctx} count={issues.length} />
          <MobileStatusNav ctx={ctx} />
          <Content issues={issues} ctx={ctx} view={view} />
        </div>
      </div>
      {current ? <Drawer issue={current} ctx={ctx} error={error} /> : null}
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </>
  )
}

function Content({ issues, ctx, view }: { issues: Issue[]; ctx: PageFilters; view: string }) {
  if (issues.length === 0) return <EmptyState ctx={ctx} />
  if (view === "list") return <IssueList issues={issues} ctx={ctx} />
  return <Board issues={issues} ctx={ctx} />
}

function Sidebar({ all, ctx }: { all: Issue[]; ctx: PageFilters }) {
  const labels = distinct(all.flatMap((issue) => issue.labels))
  const people = distinct(all.map((issue) => issue.assignee ?? ""))
  return (
    <nav id="sidebar" class="hidden w-56 shrink-0 flex-col border-r border-hairline md:flex">
      <div class="flex h-12 shrink-0 items-center gap-2 px-4">
        <span class="grid size-5 shrink-0 place-items-center rounded-[5px] bg-primary text-[11px] font-semibold text-on-primary">
          y
        </span>
        <span class="text-[13px] font-medium tracking-tight text-ink">yaru</span>
      </div>
      <div class="flex-1 overflow-y-auto px-2 pb-4">
        <NavItem
          href={pageHref({ ...ctx, status: undefined })}
          active={!ctx.status}
          icon={<AllIcon />}
          label="All issues"
          count={all.length}
        />
        <div class="mt-4 mb-1 px-2 text-[11px] font-medium text-ink-tertiary">Status</div>
        {STATUSES.map((status) => (
          <NavItem
            href={pageHref({ ...ctx, status: ctx.status === status ? undefined : status })}
            active={ctx.status === status}
            icon={<StatusIcon status={status} />}
            label={labelStatus(status)}
            count={all.filter((issue) => issue.status === status).length}
          />
        ))}
        {labels.length > 0 ? (
          <>
            <div class="mt-4 mb-1 px-2 text-[11px] font-medium text-ink-tertiary">Labels</div>
            {labels.map((label) => (
              <NavItem
                href={pageHref({ ...ctx, label: ctx.label === label ? undefined : label })}
                active={ctx.label === label}
                icon={<LabelDot label={label} />}
                label={label}
                count={all.filter((issue) => issue.labels.includes(label)).length}
              />
            ))}
          </>
        ) : null}
        {people.length > 0 ? (
          <>
            <div class="mt-4 mb-1 px-2 text-[11px] font-medium text-ink-tertiary">People</div>
            {people.map((person) => (
              <NavItem
                href={pageHref({ ...ctx, assignee: ctx.assignee === person ? undefined : person })}
                active={ctx.assignee === person}
                icon={<Avatar name={person} />}
                label={person}
                count={all.filter((issue) => issue.assignee === person).length}
              />
            ))}
          </>
        ) : null}
      </div>
      <div class="shrink-0 border-t border-hairline px-4 py-3 text-[11px] text-ink-tertiary">
        <Kbd>C</Kbd> new · <Kbd>/</Kbd> search · <Kbd>J K</Kbd> move
      </div>
    </nav>
  )
}

function NavItem({
  href,
  active,
  icon,
  label,
  count,
}: {
  href: string
  active: boolean
  icon: unknown
  label: string
  count: number
}) {
  return (
    <a
      href={href}
      class={`flex h-7 items-center gap-2 rounded-md px-2 no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50 ${
        active ? "bg-surface-2 text-ink" : "text-ink-subtle hover:bg-surface-1 hover:text-ink"
      }`}
    >
      {icon}
      <span class="min-w-0 flex-1 truncate text-[13px]">{label}</span>
      <span class="text-[11px] text-ink-tertiary tabular-nums">{count}</span>
    </a>
  )
}

function Header({ ctx, count }: { ctx: PageFilters; count: number }) {
  const list = ctx.view === "list"
  return (
    <header class="flex h-12 shrink-0 items-center gap-3 border-b border-hairline px-4">
      <span class="grid size-5 shrink-0 place-items-center rounded-[5px] bg-primary text-[11px] font-semibold text-on-primary md:hidden">
        y
      </span>
      <h1 class="hidden shrink-0 items-center gap-2 text-[13px] font-medium text-ink sm:flex">
        {ctx.status ? labelStatus(ctx.status) : "All issues"}
        <span class="font-normal text-ink-tertiary tabular-nums">{count}</span>
      </h1>
      <FilterChips ctx={ctx} />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <SearchBox ctx={ctx} />
        <ViewToggle ctx={ctx} list={list} />
        <a
          id="new-issue"
          href={newHref(ctx, ctx.status)}
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary pr-2.5 pl-2 text-xs font-medium text-on-primary no-underline transition-colors hover:bg-primary-hover active:bg-primary-focus focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-focus/50"
        >
          <PlusIcon />
          <span class="hidden sm:inline">New issue</span>
          <span class="sm:hidden">New</span>
        </a>
      </div>
    </header>
  )
}

function FilterChips({ ctx }: { ctx: PageFilters }) {
  const chips: { icon: unknown; text: string; href: string }[] = []
  if (ctx.label)
    chips.push({
      icon: <LabelDot label={ctx.label} />,
      text: ctx.label,
      href: pageHref({ ...ctx, label: undefined }),
    })
  if (ctx.assignee)
    chips.push({
      icon: <Avatar name={ctx.assignee} />,
      text: ctx.assignee,
      href: pageHref({ ...ctx, assignee: undefined }),
    })
  if (chips.length === 0) return null
  return (
    <div class="hidden min-w-0 items-center gap-1.5 overflow-hidden lg:flex">
      {chips.map((chip) => (
        <a
          href={chip.href}
          class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-surface-1 pr-1.5 pl-2 text-xs text-ink-muted no-underline transition-colors hover:border-hairline-strong focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
        >
          {chip.icon}
          {chip.text}
          <CrossIcon />
        </a>
      ))}
    </div>
  )
}

function SearchBox({ ctx }: { ctx: PageFilters }) {
  return (
    <form method="get" action="/" class="relative hidden sm:block">
      {ctx.status ? <input type="hidden" name="status" value={ctx.status} /> : null}
      {ctx.assignee ? <input type="hidden" name="assignee" value={ctx.assignee} /> : null}
      {ctx.label ? <input type="hidden" name="label" value={ctx.label} /> : null}
      {ctx.view === "list" ? <input type="hidden" name="view" value="list" /> : null}
      <SearchIcon />
      <input
        id="q"
        type="search"
        name="query"
        value={ctx.query ?? ""}
        placeholder="Search"
        autocomplete="off"
        class="peer h-7 w-44 rounded-md border border-hairline bg-transparent pr-7 pl-7 font-sans text-[13px] text-ink transition-colors placeholder:text-ink-tertiary hover:border-hairline-strong focus-visible:border-hairline-strong focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50 lg:w-56"
      />
      <span class="pointer-events-none absolute top-1/2 right-1.5 hidden -translate-y-1/2 peer-placeholder-shown:block">
        <Kbd>/</Kbd>
      </span>
    </form>
  )
}

function ViewToggle({ ctx, list }: { ctx: PageFilters; list: boolean }) {
  const tab = (active: boolean) =>
    `grid h-6 w-7 place-items-center rounded-[5px] no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50 ${
      active ? "bg-surface-3 text-ink" : "text-ink-tertiary hover:text-ink"
    }`
  return (
    <div class="flex shrink-0 items-center gap-0.5 rounded-md border border-hairline p-0.5">
      <a href={pageHref({ ...ctx, view: "board" })} class={tab(!list)} title="Board">
        <BoardIcon />
      </a>
      <a href={pageHref({ ...ctx, view: "list" })} class={tab(list)} title="List">
        <ListIcon />
      </a>
    </div>
  )
}

function MobileStatusNav({ ctx }: { ctx: PageFilters }) {
  const pill = (active: boolean) =>
    `inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs no-underline transition-colors ${
      active ? "bg-surface-2 text-ink" : "text-ink-subtle hover:text-ink"
    }`
  return (
    <div class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline px-3 py-1.5 md:hidden">
      <a href={pageHref({ ...ctx, status: undefined })} class={pill(!ctx.status)}>
        All
      </a>
      {STATUSES.map((status) => (
        <a
          href={pageHref({ ...ctx, status: ctx.status === status ? undefined : status })}
          class={pill(ctx.status === status)}
        >
          <StatusIcon status={status} />
          {labelStatus(status)}
        </a>
      ))}
    </div>
  )
}

function Board({ issues, ctx }: { issues: Issue[]; ctx: PageFilters }) {
  const shown = ctx.status
    ? columns(issues).filter((status) => status === ctx.status)
    : columns(issues)
  return (
    <main id="board" class="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 py-3">
      {shown.map((status) => {
        const items = issues.filter((issue) => issue.status === status)
        return (
          <section
            data-status={status}
            class="group flex h-full w-[300px] shrink-0 flex-col rounded-lg transition-colors data-[over]:bg-surface-1"
          >
            <div class="flex shrink-0 items-center gap-2 px-2 py-2">
              <StatusIcon status={status} />
              <h2 class="text-[13px] font-medium tracking-tight text-ink">{labelStatus(status)}</h2>
              <span class="text-xs text-ink-tertiary tabular-nums">{items.length}</span>
              <a
                href={newHref(ctx, status)}
                title={`New ${labelStatus(status)} issue`}
                class="ml-auto grid size-5 place-items-center rounded text-ink-tertiary opacity-0 no-underline transition-opacity group-hover:opacity-100 hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
              >
                <PlusIcon />
              </a>
            </div>
            <div class="min-h-16 flex-1 overflow-y-auto px-2 pb-2">
              {items.map((issue) => (
                <IssueCard issue={issue} ctx={ctx} />
              ))}
            </div>
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
      class="mb-2 block cursor-pointer rounded-lg border border-hairline bg-surface-1 p-3 text-ink no-underline shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.03)] transition-colors select-none hover:border-hairline-strong hover:bg-surface-2 aria-selected:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="font-mono text-[11px] text-ink-tertiary">{issue.id}</span>
        {issue.assignee ? <Avatar name={issue.assignee} /> : null}
      </div>
      <div class="mt-1 line-clamp-2 text-[13px] leading-snug font-medium tracking-tight text-ink">
        {issue.title}
      </div>
      {issue.priority || issue.dueDate || issue.labels.length > 0 ? (
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <PriorityIcon priority={issue.priority} />
          <DueStamp date={issue.dueDate} />
          {issue.labels.map((label) => (
            <LabelChip label={label} />
          ))}
        </div>
      ) : null}
    </a>
  )
}

function IssueList({ issues, ctx }: { issues: Issue[]; ctx: PageFilters }) {
  return (
    <main id="board" class="min-h-0 flex-1 overflow-y-auto">
      {columns(issues).map((status) => {
        const items = issues.filter((issue) => issue.status === status)
        if (items.length === 0) return null
        return (
          <section data-status={status}>
            <div class="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-hairline bg-surface-1 px-4">
              <StatusIcon status={status} />
              <h2 class="text-[13px] font-medium text-ink">{labelStatus(status)}</h2>
              <span class="text-xs text-ink-tertiary tabular-nums">{items.length}</span>
            </div>
            {items.map((issue) => (
              <IssueRow issue={issue} ctx={ctx} />
            ))}
          </section>
        )
      })}
    </main>
  )
}

function IssueRow({ issue, ctx }: { issue: Issue; ctx: PageFilters }) {
  return (
    <a
      href={pageHref(ctx, issue.id)}
      data-id={issue.id}
      data-status={issue.status}
      class="flex h-10 items-center gap-3 border-b border-hairline/60 px-4 text-ink no-underline transition-colors hover:bg-surface-1 aria-selected:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-focus/50"
    >
      <span class="w-4 shrink-0">
        <PriorityIcon priority={issue.priority} />
      </span>
      <span class="w-8 shrink-0 font-mono text-[11px] text-ink-tertiary">{issue.id}</span>
      <span class="min-w-0 flex-1 truncate text-[13px] font-medium">{issue.title}</span>
      <span class="hidden shrink-0 items-center gap-1.5 lg:flex">
        {issue.labels.map((label) => (
          <LabelChip label={label} />
        ))}
      </span>
      <span class="hidden w-20 shrink-0 text-right sm:inline">
        <DueStamp date={issue.dueDate} />
      </span>
      <span class="w-[18px] shrink-0">
        {issue.assignee ? <Avatar name={issue.assignee} /> : null}
      </span>
    </a>
  )
}

function EmptyState({ ctx }: { ctx: PageFilters }) {
  const filtered = Boolean(ctx.query || ctx.status || ctx.assignee || ctx.label)
  return (
    <main id="board" class="grid min-h-0 flex-1 place-items-center">
      <div class="flex flex-col items-center gap-3 pb-16 text-center">
        <span class="grid size-10 place-items-center rounded-xl border border-hairline bg-surface-1 text-ink-tertiary">
          {filtered ? <SearchIconLarge /> : <AllIcon />}
        </span>
        <div class="text-[13px] font-medium text-ink">
          {filtered ? "No matching issues" : "No issues yet"}
        </div>
        {filtered ? (
          <a
            href={pageHref({ view: ctx.view })}
            class="text-xs text-primary-hover no-underline hover:underline"
          >
            Clear filters
          </a>
        ) : (
          <div class="text-xs text-ink-tertiary">
            Press <Kbd>C</Kbd> or click New issue to create one
          </div>
        )}
      </div>
    </main>
  )
}

function Drawer({ issue, ctx, error }: { issue: Issue; ctx: PageFilters; error?: string }) {
  const statuses = columns([issue])
  return (
    <aside class="fixed inset-y-0 right-0 z-20 flex w-full max-w-[440px] flex-col border-l border-hairline bg-surface-1 shadow-2xl shadow-black/50">
      <form method="post" action="/issues" class="flex h-full min-h-0 flex-col">
        {ctx.query ? <input type="hidden" name="query" value={ctx.query} /> : null}
        {ctx.view && ctx.view !== "board" ? (
          <input type="hidden" name="view" value={ctx.view} />
        ) : null}
        {ctx.status ? <input type="hidden" name="filter_status" value={ctx.status} /> : null}
        {ctx.assignee ? <input type="hidden" name="filter_assignee" value={ctx.assignee} /> : null}
        {ctx.label ? <input type="hidden" name="label" value={ctx.label} /> : null}
        {issue.id ? <input type="hidden" name="id" value={issue.id} /> : null}
        <div class="flex h-12 shrink-0 items-center gap-2 border-b border-hairline px-4">
          <span class="font-mono text-[11px] text-ink-tertiary">{issue.id || "New issue"}</span>
          <a
            id="drawer-close"
            href={pageHref(ctx)}
            title="Close (Esc)"
            class="ml-auto grid size-6 place-items-center rounded-md text-ink-tertiary no-underline transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
          >
            <CrossIcon />
          </a>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {error ? (
            <p class="rounded-md border border-semantic-danger/40 bg-semantic-danger/10 px-3 py-2 text-[13px] text-semantic-danger">
              {error}
            </p>
          ) : null}
          <input
            name="title"
            value={issue.title}
            placeholder="Issue title"
            autofocus={!issue.id}
            class="w-full border-0 bg-transparent px-0 font-sans text-[15px] font-semibold text-ink placeholder:text-ink-tertiary focus-visible:outline-none"
          />
          <div class="flex flex-col gap-2">
            <PropRow label="Status">
              <SelectBox name="status">
                {statuses.map((status) => (
                  <option value={status} selected={status === issue.status}>
                    {labelStatus(status)}
                  </option>
                ))}
              </SelectBox>
            </PropRow>
            <PropRow label="Priority">
              <SelectBox name="priority">
                <option value="" selected={!issue.priority}>
                  No priority
                </option>
                {PRIORITIES.map((priority) => (
                  <option value={priority} selected={issue.priority === priority}>
                    {labelPriority(priority)}
                  </option>
                ))}
              </SelectBox>
            </PropRow>
            <PropRow label="Assignee">
              <input
                name="assignee"
                value={issue.assignee ?? ""}
                placeholder="Unassigned"
                class={FIELD}
              />
            </PropRow>
            <PropRow label="Due date">
              <input type="date" name="dueDate" value={issue.dueDate ?? ""} class={FIELD} />
            </PropRow>
            <PropRow label="Labels">
              <input
                name="labels"
                value={issue.labels.join(", ")}
                placeholder="Comma separated"
                class={FIELD}
              />
            </PropRow>
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-1.5 border-t border-hairline pt-4">
            <span class="text-xs text-ink-tertiary">Description</span>
            <textarea
              name="body"
              placeholder="Write a description…"
              class="min-h-40 w-full flex-1 resize-none border-0 bg-transparent p-0 font-sans text-[13px] leading-relaxed text-ink placeholder:text-ink-tertiary focus-visible:outline-none"
            >
              {issue.body}
            </textarea>
          </div>
        </div>
        <div class="flex shrink-0 items-center justify-end gap-2 border-t border-hairline px-4 py-3">
          <a
            href={pageHref(ctx)}
            class="inline-flex h-7 items-center rounded-md border border-hairline px-3 text-xs font-medium text-ink no-underline transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-focus/50"
          >
            Close
          </a>
          <button
            type="submit"
            class="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-primary px-3 font-sans text-xs font-medium text-on-primary transition-colors hover:bg-primary-hover active:bg-primary-focus focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-focus/50"
          >
            Save
            <span class="font-mono text-[10px] text-on-primary/60">⌘⏎</span>
          </button>
        </div>
      </form>
    </aside>
  )
}

const FIELD =
  "h-7 w-full rounded-md border border-transparent bg-transparent px-2 font-sans text-[13px] text-ink transition-colors placeholder:text-ink-tertiary hover:bg-surface-2 focus-visible:border-hairline-strong focus-visible:bg-surface-2 focus-visible:outline-none"

function PropRow({ label, children }: PropsWithChildren<{ label: string }>) {
  return (
    <label class="flex items-center gap-3">
      <span class="w-20 shrink-0 text-xs text-ink-tertiary">{label}</span>
      {children}
    </label>
  )
}

function SelectBox({ name, children }: PropsWithChildren<{ name: string }>) {
  return (
    <div class="relative w-fit">
      <select name={name} class={`${FIELD} w-auto appearance-none pr-7`}>
        {children}
      </select>
      <span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-tertiary">
        <ChevronIcon />
      </span>
    </div>
  )
}

function DueStamp({ date }: { date: string | null }) {
  if (!date) return null
  const overdue = isOverdue(date)
  return (
    <span
      data-overdue={overdue ? "" : undefined}
      class={`font-mono text-[11px] ${overdue ? "text-semantic-danger" : "text-ink-subtle"}`}
    >
      {date}
    </span>
  )
}

function LabelChip({ label }: { label: string }) {
  return (
    <span class="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2 py-px text-[11px] text-ink-subtle">
      <LabelDot label={label} />
      {label}
    </span>
  )
}

function LabelDot({ label }: { label: string }) {
  return <span class="size-2 shrink-0 rounded-full" style={`background: ${tint(label)}`} />
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      title={name}
      class="grid size-[18px] shrink-0 place-items-center rounded-full text-[9px] font-medium text-white/90 uppercase select-none"
      style={`background: color-mix(in oklab, ${tint(name)} 45%, #17181a)`}
    >
      {[...name][0] ?? "?"}
    </span>
  )
}

const PALETTE = [
  "#4ea7fc",
  "#4cb782",
  "#f2c94c",
  "#f2994a",
  "#eb5757",
  "#de5d9c",
  "#a385e0",
  "#4cc3c9",
  "#95a2b3",
  "#6771c5",
]

// 776 spreads common tracker words (bug, cli, design, dx, web, …) across all buckets.
function tint(text: string): string {
  let h = 0
  for (const c of text) h = (h * 776 + c.codePointAt(0)!) >>> 0
  return PALETTE[h % PALETTE.length]!
}

function StatusIcon({ status }: { status: string }) {
  if (status === "backlog")
    return (
      <svg class="size-3.5 shrink-0 text-ink-tertiary" viewBox="0 0 14 14" aria-hidden="true">
        <circle
          cx="7"
          cy="7"
          r="5.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-dasharray="1.8 1.9"
        />
      </svg>
    )
  if (status === "in_progress")
    return (
      <svg class="size-3.5 shrink-0 text-priority-medium" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M7 4.2 A2.8 2.8 0 0 1 7 9.8 Z" fill="currentColor" />
      </svg>
    )
  if (status === "done")
    return (
      <svg class="size-3.5 shrink-0 text-primary" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6.4" fill="currentColor" />
        <path
          d="M4.2 7.2l1.9 1.9 3.7-4.1"
          fill="none"
          stroke="var(--color-canvas)"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    )
  if (status === "canceled")
    return (
      <svg class="size-3.5 shrink-0 text-ink-tertiary" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6.4" fill="currentColor" />
        <path
          d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4"
          stroke="var(--color-canvas)"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    )
  return (
    <svg class="size-3.5 shrink-0 text-ink-subtle" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
    </svg>
  )
}

function PriorityIcon({ priority }: { priority: Priority | null }) {
  if (!priority) return null
  if (priority === "urgent")
    return (
      <svg
        data-priority="urgent"
        class="size-3.5 shrink-0 text-priority-urgent"
        viewBox="0 0 14 14"
        aria-hidden="true"
      >
        <rect x="0.5" y="0.5" width="13" height="13" rx="3.5" fill="currentColor" />
        <path
          d="M7 3.6v4.1"
          stroke="var(--color-canvas)"
          stroke-width="1.7"
          stroke-linecap="round"
        />
        <circle cx="7" cy="10.3" r="1" fill="var(--color-canvas)" />
      </svg>
    )
  const lit = { high: 3, medium: 2, low: 1 }[priority]
  return (
    <svg
      data-priority={priority}
      class="size-3.5 shrink-0 text-ink-subtle"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="8"
        width="3"
        height="5"
        rx="1"
        fill="currentColor"
        fill-opacity={lit >= 1 ? "1" : "0.3"}
      />
      <rect
        x="5.5"
        y="5"
        width="3"
        height="8"
        rx="1"
        fill="currentColor"
        fill-opacity={lit >= 2 ? "1" : "0.3"}
      />
      <rect
        x="10"
        y="2"
        width="3"
        height="11"
        rx="1"
        fill="currentColor"
        fill-opacity={lit >= 3 ? "1" : "0.3"}
      />
    </svg>
  )
}

function AllIcon() {
  return (
    <svg class="size-3.5 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2 3.5h10M2 7h10M2 10.5h6.5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

function BoardIcon() {
  return (
    <svg class="size-3.5" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1.5" y="2" width="4.5" height="10" rx="1.5" fill="currentColor" />
      <rect x="8" y="2" width="4.5" height="6.5" rx="1.5" fill="currentColor" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg class="size-3.5" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2 3.5h10M2 7h10M2 10.5h10"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg class="size-3.5" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg class="size-3" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3.5 3.5l7 7M10.5 3.5l-7 7"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg class="size-3" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3.5 5.5L7 9l3.5-3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-tertiary"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <circle cx="6.2" cy="6.2" r="4" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M9.2 9.2L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

function SearchIconLarge() {
  return (
    <svg class="size-4" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="6.2" cy="6.2" r="4" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M9.2 9.2L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

function Kbd({ children }: PropsWithChildren) {
  return (
    <kbd class="rounded-sm border border-hairline bg-surface-1 px-1 font-mono text-[10px] text-ink-tertiary">
      {children}
    </kbd>
  )
}

export function ErrorView({ message }: { message: string }) {
  return (
    <main class="grid h-screen place-items-center">
      <div class="flex flex-col items-center gap-3 pb-16 text-center">
        <span class="grid size-10 place-items-center rounded-xl border border-hairline bg-surface-1 text-ink-tertiary">
          <CrossIcon />
        </span>
        <p class="text-[13px] text-ink-muted">{message}</p>
        <a
          href="/"
          class="text-xs text-primary-hover no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus/50"
        >
          back
        </a>
      </div>
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

function labelPriority(priority: Priority): string {
  return priority.replace(/^\w/, (c) => c.toUpperCase())
}

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
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
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      const form = document.querySelector("aside form")
      if (form) form.requestSubmit()
      return
    }
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

  const dirtyForm = (root) => {
    if (!root) return false
    if (root.contains(document.activeElement) && typing(document.activeElement)) return true
    for (const el of root.querySelectorAll("input, textarea, select")) {
      if (el.type === "hidden") continue
      if (el.tagName === "SELECT") {
        const selected = el.querySelector("option[selected]")
        if ((selected ? selected.value : "") !== el.value) return true
      } else if (el.value !== el.defaultValue) return true
    }
    return false
  }

  let liveSeq = 0
  let liveTimer
  const live = new EventSource("/events")
  live.onmessage = () => {
    clearTimeout(liveTimer)
    liveTimer = setTimeout(async () => {
      const n = ++liveSeq
      const res = await fetch(location.pathname + location.search, { cache: "no-store" })
      const html = await res.text()
      if (n !== liveSeq) return
      const doc = new DOMParser().parseFromString(html, "text/html")
      for (const key of ["board", "sidebar"]) {
        const next = doc.getElementById(key)
        const cur = document.getElementById(key)
        if (key === "board") {
          const selected = cur && cur.querySelector("[aria-selected='true']")
          const selectedId = selected && selected.getAttribute("data-id")
          if (next && cur) cur.replaceWith(next)
          if (selectedId) {
            const el = document.querySelector('#board [data-id="' + CSS.escape(selectedId) + '"]')
            if (el) el.setAttribute("aria-selected", "true")
          }
        } else if (next && cur) cur.replaceWith(next)
      }
      const nextAside = doc.querySelector("aside")
      const aside = document.querySelector("aside")
      if (dirtyForm(aside)) return
      if (aside && nextAside) aside.replaceWith(nextAside)
      else if (aside && !nextAside) aside.remove()
      else if (!aside && nextAside) document.body.append(nextAside)
    }, 80)
  }
})()
`
