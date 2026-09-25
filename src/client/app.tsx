import { useCallback, useEffect, useState } from "preact/hooks"
import { BLANK, DEFAULT_VIEW, parseView, type PageData, type ViewMode } from "../page"
import { BoardContent } from "./board/board-content"
import { Header } from "./board/header"
import { MobileStatusNav } from "./board/mobile-status-nav"
import { Sidebar } from "./board/sidebar"
import { copyText } from "./clipboard"
import { ContextMenu, type OpenMenu } from "./context-menu/context-menu"
import { Alert } from "../components/alert"
import { Notice } from "../components/notice"
import { issueMenu, type MenuAction } from "./issue-menu"
import { IssueView } from "./issue-view"
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts"
import { usePageController } from "./use-page-controller"
import { useSidebarPreference } from "./use-sidebar-preference"
import { newIssueHref, pageHref, type PageFilters } from "./view-model"

// 板の画面の組み立て役。状態とその操作 (usePageController) を各部品へ配り、
// 右クリックのメニューと知らせ、同じ板の中のリンクをページを読み直さずに開く処理だけをここで持つ

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
          <BoardContent
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
      {state.requestError && !state.current ? <Alert floating>{state.requestError}</Alert> : null}
    </div>
  )
}
