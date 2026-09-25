import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks"
import { BLANK, DEFAULT_VIEW, parseView, type PageData, type ViewMode } from "../page"
import { STATUSES, type Issue } from "../store"
import {
  AllIcon,
  BoardIcon,
  CrossIcon,
  ListIcon,
  LogoLink,
  PlusIcon,
  PriorityIcon,
  QuestionIcon,
  SearchIcon,
  SearchIconLarge,
  SidebarIcon,
  StatusIcon,
} from "../components/icons"
import { ContextMenu, Notice, type OpenMenu } from "./context-menu"
import { issueMenu, type MenuAction } from "./issue-menu"
import { IssueView } from "./issue-view"
import { Avatar, DueStamp, Kbd, LabelChip, LabelDot } from "../components/issue-metadata"
import { usePageController, type PageController } from "./use-page-controller"
import { useSidebarPreference, type SidebarPreference } from "./use-sidebar-preference"
import { issueColumns, newIssueHref, pageHref, statusLabel, type PageFilters } from "./view-model"

export { BLANK, DEFAULT_VIEW, parseView }
export type { ViewMode }

export type BoardPageProps = Omit<PageData, "view"> & { view?: ViewMode }

export function BoardPage(props: BoardPageProps) {
  const controller = usePageController({ ...props, view: props.view ?? DEFAULT_VIEW })
  const { state } = controller
  const filters: PageFilters = {
    query: state.query,
    status: state.status,
    assignee: state.assignee,
    label: state.label,
    view: state.view,
    basePath: state.basePath ?? "",
  }
  const sidebar = useSidebarPreference()
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // issue の行・カード・子 issue の行で右クリックしたとき、その issue のメニューを開く
  const openIssueMenu = useCallback(
    (issueId: string, x: number, y: number) => {
      const issue = controller.state.all.find((row) => row.id === issueId)
      if (!issue) return
      const boardUrl = new URL(pageHref({ basePath: filters.basePath }), window.location.href).href
      controller.selectIssue(issueId)
      setMenu({
        items: issueMenu(issue, controller.state.all, { now: new Date(), boardUrl }),
        x,
        y,
      })
    },
    [controller.selectIssue, controller.state.all, filters.basePath],
  )

  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest("input, textarea, select, [contenteditable]")) return
      const row = target.closest<HTMLElement>("[data-id]")
      if (!row?.dataset.id) return
      event.preventDefault()
      openIssueMenu(row.dataset.id, event.clientX, event.clientY)
    },
    [openIssueMenu],
  )

  const closeMenu = useCallback(() => setMenu(null), [])

  const onMenuAction = useCallback(
    (action: MenuAction) => {
      if (action.type === "save") {
        void controller.patchIssue(action.issueId, action.input)
        return
      }
      if (action.type === "open") {
        void controller.navigate(pageHref(filters, action.issueId))
        return
      }
      if (action.type === "createSubIssue") {
        void controller.navigate(newIssueHref(filters, undefined, action.parentId))
        return
      }
      void copyText(action.text).then((copied) =>
        setNotice(copied ? "Copied to clipboard" : "Could not copy to clipboard"),
      )
    },
    [controller.navigate, controller.patchIssue, filters],
  )

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 1600)
    return () => clearTimeout(timer)
  }, [notice])

  useKeyboardShortcuts(controller, filters, openIssueMenu)

  const onNavigate = useCallback(
    (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest("a")
      if (!link || link.target || link.download) return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname !== `${filters.basePath}/`) return
      event.preventDefault()
      void controller.navigate(url.href)
    },
    [controller.navigate, filters.basePath],
  )

  const onSearch = useCallback(
    (query: string) => {
      void controller.navigate(pageHref({ ...filters, query: query || undefined }), "replace")
    },
    [controller.navigate, filters.assignee, filters.label, filters.status, filters.view],
  )

  return (
    <div class="h-screen" onClick={onNavigate} onContextMenu={onContextMenu}>
      <div class="flex h-full">
        <Sidebar
          all={state.all}
          filters={filters}
          sidebar={sidebar}
          awaitingQuestionCount={state.awaitingQuestionCount ?? 0}
        />
        <div class="flex min-w-0 flex-1 flex-col">
          <Header
            filters={filters}
            count={state.issues.length}
            onSearch={onSearch}
            onOpenSidebar={sidebar.openSidebar}
          />
          <MobileStatusNav
            filters={filters}
            awaitingQuestionCount={state.awaitingQuestionCount ?? 0}
          />
          <Content
            issues={state.issues}
            filters={filters}
            view={state.view}
            selectedIssueId={state.selectedIssueId}
            onMoveIssue={controller.moveIssue}
          />
        </div>
      </div>
      {state.current ? (
        <IssueView
          issue={state.current}
          all={state.all}
          filters={filters}
          draftDirty={state.draftDirty}
          saveState={state.saveState}
          onCommit={controller.commitField}
          error={state.requestError ?? state.error}
          labelInput={state.labelInput}
          blockInput={state.blockInput}
          comments={state.comments}
          questions={state.questions ?? []}
          onChange={controller.changeDraft}
          onSave={controller.saveCurrent}
        />
      ) : null}
      {menu ? <ContextMenu menu={menu} onAction={onMenuAction} onClose={closeMenu} /> : null}
      {notice ? <Notice text={notice} /> : null}
      {state.requestError && !state.current ? (
        <p class="fixed top-0 right-0 z-20 rounded-md border border-semantic-danger/40 bg-surface-1 px-3 py-2 text-semantic-danger">
          {state.requestError}
        </p>
      ) : null}
    </div>
  )
}

function Content({
  issues,
  filters,
  view,
  selectedIssueId,
  onMoveIssue,
}: {
  issues: Issue[]
  filters: PageFilters
  view: string
  selectedIssueId: string | null
  onMoveIssue: (issueId: string, status: string) => Promise<void>
}) {
  if (issues.length === 0) return <EmptyState filters={filters} />
  if (view === "list") {
    return <IssueList issues={issues} filters={filters} selectedIssueId={selectedIssueId} />
  }
  return (
    <Board
      issues={issues}
      filters={filters}
      selectedIssueId={selectedIssueId}
      onMoveIssue={onMoveIssue}
    />
  )
}

function Sidebar({
  all,
  filters,
  sidebar,
  awaitingQuestionCount,
}: {
  all: Issue[]
  filters: PageFilters
  sidebar: SidebarPreference
  awaitingQuestionCount: number
}) {
  const labels = distinct(all.flatMap((issue) => issue.labels))
  const people = distinct(all.map((issue) => issue.assignee ?? ""))
  return (
    <nav
      id="sidebar"
      class="relative hidden min-w-0 shrink-0 flex-col overflow-hidden border-r border-hairline md:flex"
    >
      <div class="flex h-12 shrink-0 items-center gap-2 px-3">
        <LogoLink />
        <span class="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight text-ink">
          yaru
        </span>
        <button
          id="sidebar-toggle"
          type="button"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          aria-controls="sidebar"
          onClick={sidebar.closeSidebar}
          class="grid size-7 shrink-0 place-items-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
        >
          <SidebarIcon />
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-2 pb-4">
        <NavItem
          href={pageHref({ ...filters, status: undefined })}
          active={!filters.status}
          icon={<AllIcon />}
          label="All issues"
          count={all.length}
        />
        <NavItem
          href={`${filters.basePath ?? ""}/dashboard`}
          active={false}
          icon={<QuestionIcon />}
          label="Dashboard"
          count={awaitingQuestionCount}
        />
        <div class="mt-4 mb-1 px-2 text-[11px] font-medium text-ink-tertiary">Status</div>
        {STATUSES.map((status) => (
          <NavItem
            href={pageHref({ ...filters, status: filters.status === status ? undefined : status })}
            active={filters.status === status}
            icon={<StatusIcon status={status} />}
            label={statusLabel(status)}
            count={all.filter((issue) => issue.status === status).length}
          />
        ))}
        {labels.length > 0 ? (
          <>
            <div class="mt-4 mb-1 px-2 text-[11px] font-medium text-ink-tertiary">Labels</div>
            {labels.map((label) => (
              <NavItem
                href={pageHref({ ...filters, label: filters.label === label ? undefined : label })}
                active={filters.label === label}
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
                href={pageHref({
                  ...filters,
                  assignee: filters.assignee === person ? undefined : person,
                })}
                active={filters.assignee === person}
                icon={<Avatar name={person} />}
                label={person}
                count={all.filter((issue) => issue.assignee === person).length}
              />
            ))}
          </>
        ) : null}
      </div>
      <div class="shrink-0 truncate border-t border-hairline px-3 py-3 text-[11px] text-ink-tertiary">
        <Kbd>C</Kbd> new · <Kbd>/</Kbd> search · <Kbd>J K</Kbd> move
      </div>
      <div
        id="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={sidebar.startResize}
        class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none hover:bg-primary"
      />
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

function Header({
  filters,
  count,
  onSearch,
  onOpenSidebar,
}: {
  filters: PageFilters
  count: number
  onSearch: (query: string) => void
  onOpenSidebar: () => void
}) {
  const list = filters.view === "list"
  return (
    <header class="flex h-12 shrink-0 items-center gap-3 border-b border-hairline px-4">
      <LogoLink class="md:hidden" />
      <button
        id="sidebar-open"
        type="button"
        title="Open sidebar"
        aria-label="Open sidebar"
        aria-controls="sidebar"
        aria-expanded="false"
        onClick={onOpenSidebar}
        class="hidden size-7 shrink-0 place-items-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
      >
        <SidebarIcon />
      </button>
      <h1 class="hidden shrink-0 items-center gap-2 text-[13px] font-medium text-ink sm:flex">
        {filters.status ? statusLabel(filters.status) : "All issues"}
        <span class="font-normal text-ink-tertiary tabular-nums">{count}</span>
      </h1>
      <FilterChips filters={filters} />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <SearchBox filters={filters} onSearch={onSearch} />
        <ViewToggle filters={filters} list={list} />
        <a
          id="new-issue"
          href={newIssueHref(filters, filters.status)}
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

function FilterChips({ filters }: { filters: PageFilters }) {
  const chips: { icon: unknown; text: string; href: string }[] = []
  if (filters.label)
    chips.push({
      icon: <LabelDot label={filters.label} />,
      text: filters.label,
      href: pageHref({ ...filters, label: undefined }),
    })
  if (filters.assignee)
    chips.push({
      icon: <Avatar name={filters.assignee} />,
      text: filters.assignee,
      href: pageHref({ ...filters, assignee: undefined }),
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

function SearchBox({
  filters,
  onSearch,
}: {
  filters: PageFilters
  onSearch: (query: string) => void
}) {
  const [query, setQuery] = useState(filters.query ?? "")
  const changed = useRef(false)

  useEffect(() => {
    setQuery(filters.query ?? "")
    changed.current = false
  }, [filters.query])

  useEffect(() => {
    if (!changed.current || query === (filters.query ?? "")) return
    const timer = setTimeout(() => onSearch(query), 120)
    return () => clearTimeout(timer)
  }, [filters.query, onSearch, query])

  return (
    <form
      method="get"
      action={pageHref({ basePath: filters.basePath })}
      class="relative hidden sm:block"
      onSubmit={(event: Event) => {
        event.preventDefault()
        onSearch(query)
      }}
    >
      {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
      {filters.assignee ? <input type="hidden" name="assignee" value={filters.assignee} /> : null}
      {filters.label ? <input type="hidden" name="label" value={filters.label} /> : null}
      {filters.view === "board" ? <input type="hidden" name="view" value="board" /> : null}
      <SearchIcon />
      <input
        id="q"
        type="search"
        name="query"
        value={query}
        onInput={(event: InputEvent) => {
          const input = event.currentTarget as HTMLInputElement
          changed.current = true
          setQuery(input.value)
        }}
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

function ViewToggle({ filters, list }: { filters: PageFilters; list: boolean }) {
  const tab = (active: boolean) =>
    `grid h-6 w-7 place-items-center rounded-[5px] no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50 ${
      active ? "bg-surface-3 text-ink" : "text-ink-tertiary hover:text-ink"
    }`
  return (
    <div class="flex shrink-0 items-center gap-0.5 rounded-md border border-hairline p-0.5">
      <a href={pageHref({ ...filters, view: "board" })} class={tab(!list)} title="Board">
        <BoardIcon />
      </a>
      <a href={pageHref({ ...filters, view: "list" })} class={tab(list)} title="List">
        <ListIcon />
      </a>
    </div>
  )
}

function MobileStatusNav({
  filters,
  awaitingQuestionCount,
}: {
  filters: PageFilters
  awaitingQuestionCount: number
}) {
  const pill = (active: boolean) =>
    `inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs no-underline transition-colors ${
      active ? "bg-surface-2 text-ink" : "text-ink-subtle hover:text-ink"
    }`
  return (
    <div class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline px-3 py-1.5 md:hidden">
      <a href={pageHref({ ...filters, status: undefined })} class={pill(!filters.status)}>
        All
      </a>
      {STATUSES.map((status) => (
        <a
          href={pageHref({ ...filters, status: filters.status === status ? undefined : status })}
          class={pill(filters.status === status)}
        >
          <StatusIcon status={status} />
          {statusLabel(status)}
        </a>
      ))}
      <a
        id="mobile-dashboard-link"
        href={`${filters.basePath ?? ""}/dashboard`}
        class={pill(false)}
      >
        <QuestionIcon />
        Dashboard
        <span class="text-ink-tertiary tabular-nums">{awaitingQuestionCount}</span>
      </a>
    </div>
  )
}

function Board({
  issues,
  filters,
  selectedIssueId,
  onMoveIssue,
}: {
  issues: Issue[]
  filters: PageFilters
  selectedIssueId: string | null
  onMoveIssue: (issueId: string, status: string) => Promise<void>
}) {
  const [draggingIssueId, setDraggingIssueId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<string | null>(null)
  const shown = filters.status
    ? issueColumns(issues).filter((status) => status === filters.status)
    : issueColumns(issues)
  return (
    <main id="board" class="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 py-3">
      {shown.map((status) => {
        const items = issues.filter((issue) => issue.status === status)
        return (
          <section
            data-status={status}
            data-over={overStatus === status ? "" : undefined}
            onDragOver={(event: DragEvent) => {
              if (!draggingIssueId) return
              event.preventDefault()
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
              setOverStatus(status)
            }}
            onDragLeave={(event: DragEvent) => {
              const relatedTarget = event.relatedTarget
              const currentTarget = event.currentTarget
              if (
                !(relatedTarget instanceof Node) ||
                !(currentTarget instanceof Node) ||
                !currentTarget.contains(relatedTarget)
              ) {
                setOverStatus(null)
              }
            }}
            onDrop={(event: DragEvent) => {
              event.preventDefault()
              const issueId = event.dataTransfer?.getData("text/plain") || draggingIssueId
              setDraggingIssueId(null)
              setOverStatus(null)
              if (!issueId || issues.find((issue) => issue.id === issueId)?.status === status)
                return
              void onMoveIssue(issueId, status)
            }}
            class="group flex h-full w-[300px] shrink-0 flex-col rounded-lg transition-colors data-[over]:bg-surface-1"
          >
            <div class="flex shrink-0 items-center gap-2 px-2 py-2">
              <StatusIcon status={status} />
              <h2 class="text-[13px] font-medium tracking-tight text-ink">{statusLabel(status)}</h2>
              <span class="text-xs text-ink-tertiary tabular-nums">{items.length}</span>
              <a
                href={newIssueHref(filters, status)}
                title={`New ${statusLabel(status)} issue`}
                class="ml-auto grid size-5 place-items-center rounded text-ink-tertiary opacity-0 no-underline transition-opacity group-hover:opacity-100 hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
              >
                <PlusIcon />
              </a>
            </div>
            <div class="min-h-16 flex-1 overflow-y-auto px-2 pb-2">
              {items.map((issue) => (
                <IssueCard
                  issue={issue}
                  filters={filters}
                  selected={selectedIssueId === issue.id}
                  onDragStart={(event) => {
                    setDraggingIssueId(issue.id)
                    event.dataTransfer?.setData("text/plain", issue.id)
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
                  }}
                  onDragEnd={() => {
                    setDraggingIssueId(null)
                    setOverStatus(null)
                  }}
                />
              ))}
            </div>
          </section>
        )
      })}
    </main>
  )
}

function IssueCard({
  issue,
  filters,
  selected,
  onDragStart,
  onDragEnd,
}: {
  issue: Issue
  filters: PageFilters
  selected: boolean
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
}) {
  return (
    <a
      href={pageHref(filters, issue.id)}
      data-id={issue.id}
      data-status={issue.status}
      draggable={true}
      aria-selected={selected ? "true" : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
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

function IssueList({
  issues,
  filters,
  selectedIssueId,
}: {
  issues: Issue[]
  filters: PageFilters
  selectedIssueId: string | null
}) {
  return (
    <main id="board" class="min-h-0 flex-1 overflow-y-auto">
      {issueColumns(issues).map((status) => {
        const items = issues.filter((issue) => issue.status === status)
        if (items.length === 0) return null
        return (
          <section data-status={status}>
            <div class="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-hairline bg-surface-1 px-4">
              <StatusIcon status={status} />
              <h2 class="text-[13px] font-medium text-ink">{statusLabel(status)}</h2>
              <span class="text-xs text-ink-tertiary tabular-nums">{items.length}</span>
            </div>
            {items.map((issue) => (
              <IssueRow issue={issue} filters={filters} selected={selectedIssueId === issue.id} />
            ))}
          </section>
        )
      })}
    </main>
  )
}

function IssueRow({
  issue,
  filters,
  selected,
}: {
  issue: Issue
  filters: PageFilters
  selected: boolean
}) {
  return (
    <a
      href={pageHref(filters, issue.id)}
      data-id={issue.id}
      data-status={issue.status}
      aria-selected={selected ? "true" : undefined}
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

function EmptyState({ filters }: { filters: PageFilters }) {
  const filtered = Boolean(filters.query || filters.status || filters.assignee || filters.label)
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
            href={pageHref({ view: filters.view })}
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

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

// Clipboard API は https か localhost でしか使えず、許可が無いと断られる
// そのときは選択した文字を copy コマンドで写す古い方法に切り替える
// https://w3c.github.io/clipboard-apis/#dom-clipboard-writetext
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {}
  }
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

function useKeyboardShortcuts(
  controller: PageController,
  filters: PageFilters,
  openIssueMenu: (issueId: string, x: number, y: number) => void,
): void {
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        const form = document.querySelector<HTMLFormElement>("aside form")
        form?.requestSubmit()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      const isTyping =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable)
      if (event.key === "Escape") {
        if (target instanceof HTMLInputElement && target.id === "q") {
          target.blur()
          return
        }
        if (!controller.state.current) return
        const url = new URL(window.location.href)
        url.searchParams.delete("id")
        url.searchParams.delete("new_status")
        url.searchParams.delete("new_parent")
        void controller.navigate(url.href)
        return
      }
      if (isTyping) return
      // 選んでいる issue のメニューを、メニューキーか Shift+F10 で開く
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const selectedId = controller.state.selectedIssueId
        if (!selectedId) return
        const row = document.querySelector<HTMLElement>(
          `#board [data-id="${CSS.escape(selectedId)}"]`,
        )
        if (!row) return
        event.preventDefault()
        const rect = row.getBoundingClientRect()
        openIssueMenu(selectedId, rect.left + 24, rect.bottom)
        return
      }
      if (event.key === "/") {
        event.preventDefault()
        document.querySelector<HTMLInputElement>("#q")?.focus()
        return
      }
      if (event.key === "c" || event.key === "n") {
        void controller.navigate(newIssueHref(filters, filters.status))
        return
      }
      if (event.key !== "j" && event.key !== "k" && event.key !== "Enter") return
      const issueIds = controller.state.issues.map((issue) => issue.id)
      if (issueIds.length === 0) return
      const selectedIndex = issueIds.indexOf(controller.state.selectedIssueId ?? "")
      if (event.key === "Enter") {
        if (selectedIndex >= 0) void controller.navigate(pageHref(filters, issueIds[selectedIndex]))
        return
      }
      event.preventDefault()
      const offset = event.key === "j" ? 1 : -1
      const startIndex = selectedIndex < 0 ? (offset > 0 ? -1 : 0) : selectedIndex
      const nextIndex = (startIndex + offset + issueIds.length) % issueIds.length
      controller.selectIssue(issueIds[nextIndex] ?? null)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [
    controller.navigate,
    controller.selectIssue,
    controller.state.issues,
    controller.state.selectedIssueId,
    filters,
    openIssueMenu,
  ])

  useEffect(() => {
    if (!controller.state.selectedIssueId) return
    const selected = document.querySelector<HTMLElement>(
      `#board [data-id="${CSS.escape(controller.state.selectedIssueId)}"]`,
    )
    selected?.scrollIntoView({ block: "nearest" })
  }, [controller.state.selectedIssueId])
}
