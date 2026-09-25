import type { VNode } from "preact"
import { useCallback, useEffect, useRef, useState } from "preact/hooks"
import { Alert } from "../components/alert"
import { ConfirmDialog } from "../components/confirm-dialog"
import { Notice } from "../components/notice"
import type { Issue, SaveInput } from "../store"
import { BulkBar } from "./bulk/bulk-bar"
import { copyText } from "./clipboard"
import { CommandPalette } from "./command-palette/command-palette"
import type { PaletteCommand } from "./command-palette/palette-entries"
import { ContextMenu, type OpenMenu } from "./context-menu/context-menu"
import type { IssueActions } from "./context-menu/issue-actions"
import { PropertyPicker } from "./context-menu/property-picker"
import {
  issueMenu,
  propertyInput,
  propertyPicker,
  type MenuAction,
  type PropertyField,
} from "./issue-menu"
import { hasUnsavedChanges, type DraftField } from "./state"
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts"
import type { PageController } from "./use-page-controller"
import { newIssueHref, pageHref, type PageFilters } from "./view-model"

// 板と issue 画面の上に重ねて開くもの (右クリックのメニュー・属性の選択・コマンドパレット・変更を捨てる確認・まとめて変える帯・知らせ) と、
// それを開くキーボードとマウスの操作をまとめる。板の組み立て役 (app.tsx) は、返したものを置くだけにする

type OpenPicker = {
  issueIds: string[]
  field: PropertyField
  anchor: { left: number; top: number; bottom: number }
  returnFocus: HTMLElement
}

// 知らせを出しておく長さ
const NOTICE_VISIBLE_MS = 2000
// 板に浮かせた誤りを出しておく長さ。読み終える前に消えないよう、知らせより長くする
const FLOATING_ERROR_VISIBLE_MS = 8000

export type BoardInteractions = {
  // 板の部品と issue 画面の部品へ context で渡す操作
  issueActions: IssueActions
  // 画面の一番外側の要素の最後に置く、重ねて開くものの全て
  overlays: VNode
  onContextMenu: (event: MouseEvent) => void
  // Shift+クリックの範囲の選択。リンクの既定の動き (新しいウィンドウで開く) より先に止めるため、capture で受ける
  onClickCapture: (event: MouseEvent) => void
  // 同じ板の中の移動。開いている issue に保存していない変更があれば、捨てるかを確かめてから移る
  navigate: (href: string) => void
}

export function useBoardInteractions(
  controller: PageController,
  filters: PageFilters,
): BoardInteractions {
  const { state } = controller
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [picker, setPicker] = useState<OpenPicker | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 変更を捨てるかを聞いている間の、捨てたあとに移る先
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const basePath = filters.basePath ?? ""
  // メニューや選択の面で行の属性を変えると、読み直しで行が別のまとまりへ移って描き直され、戻した focus が消える
  // そのときは読み直したあとに、同じ issue の行へ focus を戻す
  const refocusIssueId = useRef<string | null>(null)
  useEffect(() => {
    const issueId = refocusIssueId.current
    if (issueId === null) return
    refocusIssueId.current = null
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const row = [...document.querySelectorAll<HTMLElement>("#board [data-id]")].find(
      (element) => element.dataset.id === issueId,
    )
    row?.focus({ preventScroll: true })
  }, [state.all])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const boardUrl = () => new URL(pageHref({ basePath }), window.location.href).href

  const openMenu = (issueId: string, x: number, y: number, returnFocus: HTMLElement | null) => {
    const issue = state.all.find((row) => row.id === issueId)
    if (!issue) return
    // 板の行から開いたときは、その行を選んだことにする。続けて j / k や s で同じ行を扱えるようにするため
    if (returnFocus?.closest("#board")) controller.selectIssue(issueId)
    setPicker(null)
    setMenu({
      items: issueMenu(issue, state.all, { now: new Date(), boardUrl: boardUrl() }),
      x,
      y,
      returnFocus,
    })
  }

  const openIssueMenuAt = (issueId: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect()
    openMenu(issueId, rect.left, rect.bottom + 4, anchor)
  }

  const openPropertyPicker = (issueIds: string[], field: PropertyField, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect()
    setMenu(null)
    setPicker({
      issueIds,
      field,
      anchor: { left: rect.left, top: rect.top, bottom: rect.bottom },
      returnFocus: anchor,
    })
  }

  const onContextMenu = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest("input, textarea, select, [contenteditable]")) return
    const row = target.closest<HTMLElement>("[data-id]")
    if (!row?.dataset.id) return
    event.preventDefault()
    openMenu(row.dataset.id, event.clientX, event.clientY, row)
  }

  const onClickCapture = (event: MouseEvent) => {
    if (!event.shiftKey || event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element)) return
    const row = target.closest<HTMLElement>("#board [data-id]")
    if (!row?.dataset.id) return
    event.preventDefault()
    event.stopPropagation()
    const orderedIds = [...document.querySelectorAll<HTMLElement>("#board [data-id]")].map(
      (element) => element.dataset.id ?? "",
    )
    controller.selectBulkRange(row.dataset.id, orderedIds)
  }

  // 開いている issue から離れる移動かどうか。同じ issue の中の移動 (読み直し) では確かめない
  const leavesCurrentIssue = (href: string) => {
    const current = state.current
    if (!current) return false
    const url = new URL(href, window.location.href)
    const id = url.searchParams.get("id")
    return current.id ? id !== current.id : id !== "new"
  }

  const navigate = (href: string) => {
    if (leavesCurrentIssue(href) && hasUnsavedChanges(state)) {
      setPendingHref(href)
      return
    }
    void controller.navigate(href)
  }

  const requestClose = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete("id")
    url.searchParams.delete("new_status")
    url.searchParams.delete("new_parent")
    navigate(url.href)
  }

  // メニューや選択の面からの保存をサーバーが受け付けなかったときは、理由を画面の誤りとして出す
  // (開いている issue の欄から保存したときは、issue 画面がその欄の近くに出す)
  const showRejection = (error: unknown) =>
    controller.showError(error instanceof Error ? error.message : String(error))

  const onMenuAction = (action: MenuAction) => {
    if (action.type === "save") {
      if (menu?.returnFocus?.closest("#board")) refocusIssueId.current = action.issueId
      saveProperties(action.issueId, action.input).catch(showRejection)
      return
    }
    if (action.type === "open") {
      navigate(pageHref(filters, action.issueId))
      return
    }
    if (action.type === "createSubIssue") {
      navigate(newIssueHref(filters, undefined, action.parentId))
      return
    }
    void copyText(action.text).then((copied) =>
      setNotice(copied ? action.notice : "Could not copy to clipboard"),
    )
  }

  // 開いている issue は自動保存と同じ道 (commitField) で保存し、Saving… と、届かなかったときの下書きの保持とやり直しを効かせる
  // 新しい issue はまだ保存しないので、下書きだけを変える (commitField がそうする)。開いていない issue は patchIssue で保存する
  const saveProperties = async (issueId: string, input: Partial<SaveInput>) => {
    if (!state.current || state.current.id !== issueId) {
      await controller.patchIssue(issueId, input)
      return
    }
    for (const field of Object.keys(input) as PropertyField[]) {
      await controller.commitField(field satisfies DraftField, fieldText(field, input))
    }
  }

  const applyProperty = (field: PropertyField, value: string) => {
    if (!picker) return
    const targets = pickerTargets(picker.issueIds)
    const anchorId = picker.returnFocus.closest("#board")
      ? picker.returnFocus.dataset.id
      : undefined
    if (anchorId) refocusIssueId.current = anchorId
    const saves = targets.map((target) =>
      saveProperties(target.id, propertyInput(field, value, target, targets)),
    )
    Promise.all(saves).catch(showRejection)
    if (targets.length > 1) setNotice(`Updated ${targets.length} issues`)
  }

  const pickerTargets = (issueIds: string[]): Issue[] =>
    issueIds
      .map((issueId) =>
        state.current && state.current.id === issueId
          ? state.current
          : state.all.find((issue) => issue.id === issueId),
      )
      .filter((issue): issue is Issue => issue !== undefined)

  const onPaletteCommand = (command: PaletteCommand) => {
    if (command.type === "navigate") navigate(command.href)
    else if (command.type === "location") window.location.assign(command.href)
    else if (command.type === "createIssue") navigate(newIssueHref(filters, filters.status))
    else onMenuAction(command.action)
  }

  const openPalette = () => {
    setMenu(null)
    setPicker(null)
    setPaletteOpen(true)
  }

  const closeMenu = useCallback(() => setMenu(null), [])
  const closePicker = useCallback(() => setPicker(null), [])

  const selectedIssue = state.all.find((issue) => issue.id === state.selectedIssueId) ?? null
  const paletteTarget = state.current?.id ? state.current : state.current ? null : selectedIssue
  const overlayOpen = menu !== null || picker !== null || paletteOpen || pendingHref !== null

  useKeyboardShortcuts({
    issueOpen: state.current !== null,
    currentIssueId: state.current?.id ?? null,
    selectedIssueId: state.selectedIssueId,
    bulkSelection: state.bulkSelection,
    overlayOpen,
    newIssueHref: newIssueHref(filters, filters.status),
    issueHref: (issueId) => pageHref(filters, issueId),
    navigate,
    selectIssue: controller.selectIssue,
    openIssueMenu: openIssueMenuAt,
    openPropertyPicker,
    requestClose,
    openPalette,
    toggleBulkSelection: controller.toggleBulkSelection,
    clearBulkSelection: controller.clearBulkSelection,
  })

  // 板に浮かせた誤りは、しばらくしたら消す。issue 画面の中の誤りは、その欄の近くに出し続ける
  const floatingError = state.current ? undefined : (state.requestError ?? state.error)
  useEffect(() => {
    if (!floatingError) return
    const timer = setTimeout(controller.dismissError, FLOATING_ERROR_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [floatingError, controller.dismissError])

  const pickerData = picker
    ? propertyPicker(picker.field, pickerTargets(picker.issueIds), state.all, new Date())
    : null

  const overlays = (
    <>
      {menu ? <ContextMenu menu={menu} onAction={onMenuAction} onClose={closeMenu} /> : null}
      {picker && pickerData ? (
        <PropertyPicker
          picker={pickerData}
          anchor={picker.anchor}
          returnFocus={picker.returnFocus}
          onSelect={(value) => applyProperty(picker.field, value)}
          onCreate={(query) => applyProperty(picker.field, query)}
          onClose={closePicker}
        />
      ) : null}
      {paletteOpen ? (
        <CommandPalette
          input={{
            all: state.all,
            awaitingByIssue: state.awaitingByIssue,
            basePath,
            target: paletteTarget,
            issueHref: (issueId) => pageHref(filters, issueId),
            boardUrl: boardUrl(),
            now: new Date(),
          }}
          onRun={onPaletteCommand}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
      {pendingHref !== null ? (
        <ConfirmDialog
          title="Discard changes?"
          description={
            state.current?.id
              ? "Some changes to this issue have not been saved."
              : "This new issue has not been created yet."
          }
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={() => {
            const href = pendingHref
            setPendingHref(null)
            void controller.navigate(href)
          }}
          onCancel={() => setPendingHref(null)}
        />
      ) : null}
      {state.bulkSelection.length > 0 && !state.current ? (
        <BulkBar
          count={state.bulkSelection.length}
          onPick={(field, anchor) => openPropertyPicker(state.bulkSelection, field, anchor)}
          onClear={controller.clearBulkSelection}
        />
      ) : null}
      <Notice text={notice} />
      {floatingError ? (
        <Alert
          floating
          onDismiss={controller.dismissError}
          // 読み込み直せば直る失敗 (板の読み込み) だけに Retry を出す。断られた値や届かなかった保存は、読み込み直しても戻らない
          onRetry={
            state.requestError && state.requestRetryable
              ? () => void controller.navigate(window.location.href, "none", true)
              : undefined
          }
        >
          {floatingError}
        </Alert>
      ) : null}
    </>
  )

  return {
    issueActions: {
      openIssueMenuAt,
      openPropertyPicker,
      openCommandPalette: openPalette,
      bulkSelection: state.bulkSelection,
      toggleBulkSelection: controller.toggleBulkSelection,
      retrySave: controller.retrySave,
      returnedDrafts: state.returnedDrafts,
    },
    overlays,
    onContextMenu,
    onClickCapture,
    navigate,
  }
}

// 自動保存 (commitField) は欄の文字列で受けるので、保存の入力を欄の文字列に戻す。ラベルは「, 」でつなぐ
function fieldText(field: PropertyField, input: Partial<SaveInput>): string {
  if (field === "labels") return (input.labels ?? []).join(", ")
  const value = input[field]
  return typeof value === "string" ? value : ""
}
