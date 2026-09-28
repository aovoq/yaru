import { useCallback, useMemo } from "preact/hooks"
import { BoardApiProvider, createBoardApi, type BoardApi } from "../board/board-api"
import { BoardContent } from "../board/board-content"
import { boardClock } from "../board/clock"
import { ISSUE_GROUPS, ISSUE_SORTS } from "../board/display"
import { Header } from "../board/header"
import { MobileStatusNav } from "../board/mobile-status-nav"
import { emptyPage, type PageData } from "../board/page-data"
import { Sidebar } from "../board/sidebar"
import { readReturnedDrafts } from "../board/state"
import { pageFilters, pageHref, type PageFilters } from "../board/view-model"
import { labelColors as workspaceLabelColors } from "../components/tint"
import { createYaruClients } from "../connect/client"
import type { BoardQuery } from "../route"
import { IssueActionsContext } from "../board/context-menu/issue-actions"
import { BoardIssuePanel } from "../issue/board-issue-panel"
import { useBoardInteractions } from "./use-board-interactions"
import { usePageController } from "./use-page-controller"
import { useSidebarPreference } from "./use-sidebar-preference"

// 板の画面の組み立て。データの初回は GetPage、その後は WatchWorkspace (docs/spec/routes.md の「ライブ更新」)
// 開いている issue の中身は BoardIssuePanel。開いているあいだ板の本体だけを inert にする
// 親の App が pt-safe を持つので、板は viewport いっぱいに固定し、切り欠きの余白は見出しとサイドバーが自分で取る

export function BoardScreen({
  slug,
  query,
  fragment,
  api,
  initialPage,
  loadOnMount = true,
}: {
  slug: string
  query: BoardQuery
  fragment: string | null
  api?: BoardApi
  initialPage?: PageData
  loadOnMount?: boolean
}) {
  const resolvedApi = useMemo(
    () => api ?? createBoardApi(createYaruClients(window.location.origin), slug),
    [api, slug],
  )
  const seeded = useMemo(() => initialPage ?? seedPage(slug, query), [initialPage, slug, query])
  const returnedDrafts = useMemo(() => readReturnedDrafts(window.location.search), [])
  const controller = usePageController(seeded, {
    api: resolvedApi,
    returnedDrafts,
    loadOnMount: initialPage === undefined && loadOnMount,
  })
  const { state } = controller
  const filters: PageFilters = pageFilters(state)
  const labelColors = useMemo(
    () => workspaceLabelColors(state.all.flatMap((issue) => issue.labels)),
    [state.all],
  )
  const now = state.now ? boardClock(state.now) : null
  const sidebar = useSidebarPreference()
  const interactions = useBoardInteractions(controller, filters)

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
      if (url.origin !== window.location.origin) return
      event.preventDefault()
      interactions.navigate(url.href)
    },
    [interactions.navigate],
  )

  const onSearch = useCallback(
    (nextQuery: string) => {
      void controller.navigate(pageHref({ ...filters, query: nextQuery || undefined }), "replace")
    },
    [
      controller.navigate,
      filters.assignee,
      filters.label,
      filters.status,
      filters.awaiting,
      filters.sort,
      filters.group,
      filters.completed,
      filters.view,
    ],
  )

  return (
    <BoardApiProvider api={resolvedApi}>
      <IssueActionsContext.Provider value={interactions.issueActions}>
        <div
          class="fixed inset-0 z-0 h-dvh"
          data-screen="board"
          data-slug={slug}
          data-issue={query.id ?? undefined}
          data-error={query.error ?? undefined}
          data-fragment={fragment ?? undefined}
          onClick={onNavigate}
          onClickCapture={interactions.onClickCapture}
          onContextMenu={interactions.onContextMenu}
        >
          <div class="flex h-full">
            <Sidebar
              all={state.all}
              filters={filters}
              sidebar={sidebar}
              awaitingQuestionCount={state.awaitingQuestionCount ?? 0}
              awaitingByIssue={state.awaitingByIssue}
              labelColors={labelColors}
            />
            <div
              data-board-shell=""
              inert={state.current !== null}
              class="flex min-w-0 flex-1 flex-col"
            >
              <Header
                filters={filters}
                count={state.issues.length}
                onSearch={onSearch}
                onOpenSidebar={sidebar.openSidebar}
                awaitingQuestionCount={state.awaitingQuestionCount ?? 0}
                labelColors={labelColors}
              />
              <MobileStatusNav filters={filters} labelColors={labelColors} />
              {now ? (
                <BoardContent
                  issues={state.issues}
                  totalIssueCount={state.all.length}
                  filters={filters}
                  view={state.view}
                  group={state.display.group}
                  selectedIssueId={state.selectedIssueId}
                  awaitingByIssue={state.awaitingByIssue}
                  labelColors={labelColors}
                  now={now}
                  onMoveIssue={controller.moveIssue}
                />
              ) : (
                <main
                  id="board"
                  role="status"
                  class="text-body grid min-h-0 flex-1 place-items-center text-ink-tertiary"
                >
                  Loading…
                </main>
              )}
            </div>
          </div>
          {state.current && now ? (
            <BoardIssuePanel
              workspace={slug}
              issue={state.current}
              all={state.all}
              filters={filters}
              comments={state.comments}
              questions={state.questions ?? []}
              events={state.events}
              commits={state.commits}
              viewer={state.viewer}
              now={now}
              draftDirty={state.draftDirty}
              saveState={state.saveState}
              returnedDrafts={state.returnedDrafts}
              error={state.requestError ?? state.error}
              onChange={controller.changeDraft}
              onCommit={controller.commitField}
              onSave={controller.saveCurrent}
              onRetry={() => void controller.retrySave()}
              onPatchIssue={controller.patchIssue}
              onNavigate={interactions.navigate}
              onOpenMenu={interactions.issueActions.openIssueMenuAt}
            />
          ) : null}
          {interactions.overlays}
        </div>
      </IssueActionsContext.Provider>
    </BoardApiProvider>
  )
}

function seedPage(slug: string, query: BoardQuery): PageData {
  const page = emptyPage(`/p/${encodeURIComponent(slug)}`)
  page.query = query.query ?? ""
  if (query.status) page.status = query.status
  if (query.assignee) page.assignee = query.assignee
  if (query.label) page.label = query.label
  page.awaiting = query.awaiting === "1"
  if (query.view === "board") page.view = "board"
  const sort = known(query.sort, ISSUE_SORTS)
  const group = known(query.group, ISSUE_GROUPS)
  if (sort) page.display = { ...page.display, sort }
  if (group) page.display = { ...page.display, group }
  if (query.completed === "hide" || query.completed === "recent" || query.completed === "all") {
    page.display = { ...page.display, completed: query.completed }
  }
  if (query.error) page.error = query.error
  return page
}

function known<Choice extends string>(
  value: string | null,
  choices: readonly Choice[],
): Choice | undefined {
  if (value !== null && (choices as readonly string[]).includes(value)) return value as Choice
  return undefined
}

