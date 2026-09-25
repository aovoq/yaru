import { useCallback, useMemo } from "preact/hooks"
import { DEFAULT_VIEW, type PageData, type ViewMode } from "../page"
import { BoardContent } from "./board/board-content"
import { Header } from "./board/header"
import { MobileStatusNav } from "./board/mobile-status-nav"
import { Sidebar } from "./board/sidebar"
import { IssueActionsContext } from "./context-menu/issue-actions"
import { labelColors as workspaceLabelColors } from "../components/tint"
import { IssueView } from "./issue-view"
import type { ReturnedDrafts } from "./state"
import { useBoardInteractions } from "./use-board-interactions"
import { usePageController } from "./use-page-controller"
import { useSidebarPreference } from "./use-sidebar-preference"
import { pageFilters, pageHref, type PageFilters } from "./view-model"

// 板の画面の組み立て役。状態とその操作 (usePageController) を各部品へ配り、
// 同じ板の中のリンクをページを読み直さずに開く処理だけをここで持つ
// メニュー・属性の選択・コマンドパレット・まとめて変える帯・知らせとキーボード操作は useBoardInteractions がまとめる

export type BoardPageProps = Omit<PageData, "view"> & {
  view?: ViewMode
  // フォームの失敗で戻されたときの書きかけの文 (main.tsx が URL から読む)
  returnedDrafts?: ReturnedDrafts
}

export function BoardPage({ returnedDrafts, ...props }: BoardPageProps) {
  const controller = usePageController(
    { ...props, view: props.view ?? DEFAULT_VIEW },
    returnedDrafts,
  )
  const { state } = controller
  const filters: PageFilters = pageFilters(state)
  // ラベルの色は絞り込む前の全ての issue のラベルから決める。絞り込むたびに色が入れ替わらないようにするため
  const labelColors = useMemo(
    () => workspaceLabelColors(state.all.flatMap((issue) => issue.labels)),
    [state.all],
  )
  // 答え待ちの残り時間と期限切れは、1 回の描画の中で同じ時刻から決める
  const now = new Date()
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
      if (url.origin !== window.location.origin || url.pathname !== `${filters.basePath}/`) return
      event.preventDefault()
      interactions.navigate(url.href)
    },
    [interactions.navigate, filters.basePath],
  )

  const onSearch = useCallback(
    (query: string) => {
      void controller.navigate(pageHref({ ...filters, query: query || undefined }), "replace")
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
    <IssueActionsContext.Provider value={interactions.issueActions}>
      <div
        class="h-screen"
        onClick={onNavigate}
        onClickCapture={interactions.onClickCapture}
        onContextMenu={interactions.onContextMenu}
      >
        {/* issue 画面を開いている間は、裏の板を inert にして focus と読み上げが板へ抜けないようにする */}
        {/* https://html.spec.whatwg.org/multipage/interaction.html#the-inert-attribute */}
        <div data-board-shell="" inert={state.current !== null} class="flex h-full">
          <Sidebar
            all={state.all}
            filters={filters}
            sidebar={sidebar}
            awaitingQuestionCount={state.awaitingQuestionCount ?? 0}
            awaitingByIssue={state.awaitingByIssue}
            labelColors={labelColors}
          />
          <div class="flex min-w-0 flex-1 flex-col">
            <Header
              filters={filters}
              count={state.issues.length}
              onSearch={onSearch}
              onOpenSidebar={sidebar.openSidebar}
              awaitingQuestionCount={state.awaitingQuestionCount ?? 0}
              labelColors={labelColors}
            />
            <MobileStatusNav filters={filters} labelColors={labelColors} />
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
            comments={state.comments}
            questions={state.questions ?? []}
            events={state.events ?? []}
            commits={state.commits ?? []}
            onChange={controller.changeDraft}
            onSave={controller.saveCurrent}
            onPatchIssue={controller.patchIssue}
            onNavigate={interactions.navigate}
          />
        ) : null}
        {interactions.overlays}
      </div>
    </IssueActionsContext.Provider>
  )
}
