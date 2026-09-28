import type { DraftField } from "./model"

// issue 画面を開いているときのキー。板の j / k / c は板が受け持つ
// Esc は、打っている欄から先に離れ、次に画面を閉じる
// ⌘⏎ は focus のある欄のフォームを送る。回答欄は自分で止める
// s p a l d は、その属性の行の操作を押す

const PROPERTY_KEYS: Record<string, DraftField> = {
  s: "status",
  p: "priority",
  a: "assignee",
  l: "labels",
  d: "dueDate",
}

export function handleIssueKey(event: KeyboardEvent, requestClose: () => void): void {
  if (event.isComposing) return
  const modifier = event.metaKey || event.ctrlKey
  if (modifier && event.key === "Enter") {
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
    if (typing && target instanceof HTMLElement && target.closest("#issue-view")) {
      target.blur()
      return
    }
    requestClose()
    return
  }
  if (typing || event.shiftKey || event.repeat) return
  const field = PROPERTY_KEYS[event.key]
  if (!field) return
  const control = document.querySelector<HTMLElement>(
    `#issue-view [data-property="${field}"] :is(button, input, select, textarea)`,
  )
  if (!control) return
  event.preventDefault()
  if (control instanceof HTMLButtonElement) control.click()
  else control.focus()
}

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
