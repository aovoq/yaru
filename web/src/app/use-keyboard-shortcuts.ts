import { useLayoutEffect, useRef } from "preact/hooks"
import type { PropertyField } from "../board/issue-menu"

// 板と issue 画面のキーボード操作をまとめる。document の keydown を 1 か所で受け、何をするかを handleBoardKey で決める
// 何をするかを DOM と呼ぶ側の操作 (KeyboardContext) だけから決め、描画の部品と切り離してテストできるようにする
//
// ⌘K          コマンドパレットを開く (入力欄の中でも効く)
// ⌘⏎ / Ctrl⏎   focus のある欄が属するフォームを送る。issue のフォームは focus が issue のフォームの中にあるときだけ
// Esc         まとめた選択を外す → 検索欄から離れる → issue 画面の欄から離れる (離れると保存される) → issue 画面を閉じる
// c / n       新しい issue (issue 画面を開いていないときだけ)
// j / k       板の行を画面に並んだ順に選ぶ。Enter で選んだ issue を開く (issue 画面を開いていないときだけ)
// x           行をまとめた選択に足す・外す
// s p a l d   選んでいる行 (まとめた選択があればその全て) の状態・優先度・担当・ラベル・期日を選ぶ。issue 画面ではその属性の行の操作を押す
// Shift+F10 / メニューキー   focus のある行、無ければ選んでいる行のメニューを開く
// https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/

export type KeyboardContext = {
  // issue 画面 (既存の issue か新しい issue) を開いているか。開いている間は板の c・j・k・Enter・x を効かせない
  issueOpen: boolean
  // 開いている issue の id。新しい issue は空の文字列
  currentIssueId: string | null
  selectedIssueId: string | null
  bulkSelection: string[]
  // パレット・確認・メニュー・選択の面のどれかが開いているか。開いている間のキーはその面が受け持つ
  overlayOpen: boolean
  newIssueHref: string
  issueHref: (issueId: string) => string
  navigate: (href: string) => void
  selectIssue: (issueId: string | null) => void
  openIssueMenu: (issueId: string, anchor: HTMLElement) => void
  openPropertyPicker: (issueIds: string[], field: PropertyField, anchor: HTMLElement) => void
  // 変更が残っていれば確かめてから issue 画面を閉じる
  requestClose: () => void
  openPalette: () => void
  toggleBulkSelection: (issueId: string) => void
  clearBulkSelection: () => void
}

const PROPERTY_KEYS: Record<string, PropertyField> = {
  s: "status",
  p: "priority",
  a: "assignee",
  l: "labels",
  d: "dueDate",
}

export function handleBoardKey(event: KeyboardEvent, context: KeyboardContext): void {
  if (event.isComposing) return
  const modifier = event.metaKey || event.ctrlKey
  if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
    if (context.overlayOpen) return
    event.preventDefault()
    context.openPalette()
    return
  }
  if (context.overlayOpen) return
  if (modifier && event.key === "Enter") {
    // 回答欄のように、自分のフォームを自分で送る欄は先に preventDefault する。二重に送らないため
    if (event.defaultPrevented) return
    const form = formOf(event.target)
    if (!form) return
    event.preventDefault()
    form.requestSubmit()
    return
  }
  if (modifier || event.altKey) return
  const target = event.target
  const typing =
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select") || target.isContentEditable)
  if (event.key === "Escape") {
    onEscape(target, typing, context)
    return
  }
  if (typing) return
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    const row = focusedRow() ?? (context.issueOpen ? null : selectedRow(context))
    const issueId = row?.dataset.id
    if (!row || !issueId) return
    event.preventDefault()
    context.openIssueMenu(issueId, row)
    return
  }
  if (event.shiftKey) return
  // キーを押し続けたときの繰り返しは、選択の移動 (j / k) にだけ使う。新規作成や選択の面を開き続けないため
  if (event.repeat && event.key !== "j" && event.key !== "k") return
  const field = PROPERTY_KEYS[event.key]
  if (field) {
    // issue 画面では、その属性の行が持つ操作 (選択の面を開くボタンや日付の欄) をそのまま使う
    // 行の選択の面は、断られた理由をその行の下に出すので、別の面を重ねて開かない
    const control = context.issueOpen ? propertyControl(field) : null
    if (control) {
      event.preventDefault()
      if (control instanceof HTMLButtonElement) control.click()
      else control.focus()
      return
    }
    const picked = propertyTarget(context, field)
    if (!picked) return
    event.preventDefault()
    context.openPropertyPicker(picked.issueIds, field, picked.anchor)
    return
  }
  if (context.issueOpen) return
  if (event.key === "/") {
    event.preventDefault()
    document.querySelector<HTMLInputElement>("#q")?.focus()
    return
  }
  if (event.key === "c" || event.key === "n") {
    context.navigate(context.newIssueHref)
    return
  }
  if (event.key === "x") {
    const issueId = (focusedBoardRow() ?? selectedRow(context))?.dataset.id
    if (!issueId) return
    event.preventDefault()
    context.toggleBulkSelection(issueId)
    return
  }
  if (event.key === "Enter") {
    // リンクやボタンの上の Enter は、それ自身を押したことになる。ここでも開くと 2 回開いてしまう
    if (target instanceof Element && target.closest("a, button, [role='button']")) return
    if (context.selectedIssueId) context.navigate(context.issueHref(context.selectedIssueId))
    return
  }
  if (event.key !== "j" && event.key !== "k") return
  const rows = boardRows()
  if (rows.length === 0) return
  event.preventDefault()
  const ids = rows.map((row) => row.dataset.id ?? "")
  const selectedIndex = ids.indexOf(context.selectedIssueId ?? "")
  const offset = event.key === "j" ? 1 : -1
  const startIndex = selectedIndex < 0 ? (offset > 0 ? -1 : 0) : selectedIndex
  const nextIndex = (startIndex + offset + ids.length) % ids.length
  const nextRow = rows[nextIndex]
  context.selectIssue(nextRow?.dataset.id ?? null)
  // j / k で選んだ行だけを見える位置まで送る。右クリックで選んだときに送ると、
  // issue 画面の裏の一覧が動き、その scroll で開いたばかりのメニューが閉じてしまう
  nextRow?.scrollIntoView?.({ block: "nearest" })
}

function onEscape(target: EventTarget | null, typing: boolean, context: KeyboardContext): void {
  if (context.bulkSelection.length > 0 && !context.issueOpen) {
    context.clearBulkSelection()
    return
  }
  if (target instanceof HTMLInputElement && target.id === "q") {
    target.blur()
    return
  }
  if (!context.issueOpen) return
  // issue 画面の欄で打っている途中なら、まず欄から離れる。離れると、その欄は自動で保存される
  // 打ったまま閉じると、離れる前に画面が消えて保存されないことがあるため
  if (typing && target instanceof HTMLElement && target.closest("#issue-view")) {
    target.blur()
    return
  }
  context.requestClose()
}

// 欄が属するフォーム。form 属性で外のフォームに結びついた欄 (コメント欄・回答欄) は、その結びついた先を返す
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-owner
function formOf(target: EventTarget | null): HTMLFormElement | null {
  if (!(target instanceof Element)) return null
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement
  ) {
    if (target.form) return target.form
    const formId = target.getAttribute("form")
    const owner = formId ? document.getElementById(formId) : null
    if (owner instanceof HTMLFormElement) return owner
  }
  return target.closest("form")
}

// 板に並んだ行を画面の順に返す。同じ issue が 2 回並ぶ (まとまりの分け方によっては起こる) ときは最初のものだけにする
function boardRows(): HTMLElement[] {
  const seen = new Set<string>()
  const rows: HTMLElement[] = []
  for (const row of document.querySelectorAll<HTMLElement>("#board [data-id]")) {
    const issueId = row.dataset.id
    if (!issueId || seen.has(issueId)) continue
    seen.add(issueId)
    rows.push(row)
  }
  return rows
}

function boardRow(issueId: string): HTMLElement | null {
  return boardRows().find((row) => row.dataset.id === issueId) ?? null
}

function focusedRow(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof Element ? active.closest<HTMLElement>("[data-id]") : null
}

function focusedBoardRow(): HTMLElement | null {
  const row = focusedRow()
  return row?.closest("#board") ? row : null
}

function selectedRow(context: KeyboardContext): HTMLElement | null {
  return context.selectedIssueId ? boardRow(context.selectedIssueId) : null
}

// issue 画面の属性の行 (data-property) の中の、最初の操作 (ボタンか入力欄)
function propertyControl(field: PropertyField): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `#issue-view [data-property="${field}"] :is(button, input, select, textarea)`,
  )
}

// s / p / a / l / d で変える issue と、選択の面を開く位置
// issue 画面で属性の行に操作が無いときは、開いている issue の選択の面を題名の下に開く
// 板では、まとめた選択があればその全てを、無ければ focus のある行か選んでいる行を変える
function propertyTarget(
  context: KeyboardContext,
  field: PropertyField,
): { issueIds: string[]; anchor: HTMLElement } | null {
  if (context.issueOpen) {
    if (context.currentIssueId === null) return null
    const anchor = document.querySelector<HTMLElement>('#issue-view [name="title"]')
    return anchor ? { issueIds: [context.currentIssueId], anchor } : null
  }
  const row = focusedBoardRow() ?? selectedRow(context)
  if (context.bulkSelection.length > 0) {
    const anchor =
      (row?.dataset.id && context.bulkSelection.includes(row.dataset.id) ? row : null) ??
      context.bulkSelection.map(boardRow).find((element) => element !== null) ??
      null
    return anchor ? { issueIds: context.bulkSelection, anchor } : null
  }
  const issueId = row?.dataset.id
  return row && issueId ? { issueIds: [issueId], anchor: row } : null
}

export function useKeyboardShortcuts(context: KeyboardContext): void {
  // keydown の登録は 1 度だけにし、押されたときに最新の状態を読む。状態が変わるたびに付け外しすると、その間のキーを取りこぼすため
  const latest = useRef(context)
  latest.current = context
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleBoardKey(event, latest.current)
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])
}
