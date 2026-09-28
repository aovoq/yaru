// dashboard と受信箱の「新しい質問が来た」判定。src/ui/live-page.ts:139-214
// 受信箱とプロジェクト一覧の間隔は 30 秒。src/web.tsx:49、src/projects.tsx:46

export const POLL_INTERVAL_MS = 30_000
export const RELATIVE_TIME_INTERVAL_MS = 60_000

const RETURN_PARAMETERS = ["error", "q", "answer", "workspace", "answered"]

export function describeAwaitingChange(
  rendered: ReadonlySet<string>,
  next: readonly string[],
): string {
  const added = next.filter((anchor) => !rendered.has(anchor)).length
  return added > 0 ? `${added} new — Show` : "Updated — Show"
}

export function renderedAwaitingAnchors(root: ParentNode): Set<string> {
  const element = root.querySelector("[data-awaiting-ids]")
  const value = element instanceof HTMLElement ? (element.dataset.awaitingIds ?? "") : ""
  return new Set(value.split(" ").filter(Boolean))
}

export function sameAnchors(rendered: ReadonlySet<string>, next: readonly string[]): boolean {
  return rendered.size === next.length && next.every((anchor) => rendered.has(anchor))
}

export function isEditingAnswer(root: ParentNode): boolean {
  if (root.querySelector("#answer-toast [data-undo-until]") !== null) return true
  const active = document.activeElement
  for (const box of root.querySelectorAll("textarea[data-answer-shortcut]")) {
    if (!(box instanceof HTMLTextAreaElement)) continue
    if (box.value.trim() !== "" || box === active) return true
  }
  return false
}

export function awaitingDeadlinePassed(root: ParentNode, now: Date): boolean {
  for (const card of root.querySelectorAll("[data-answer-by]")) {
    if (!(card instanceof HTMLElement)) continue
    const answerBy = Date.parse(card.dataset.answerBy ?? "")
    if (!Number.isNaN(answerBy) && answerBy <= now.getTime()) return true
  }
  return false
}

// 一度きりの query を URL から外す。読み直しで同じ失敗や取り消しを何度も出さない。src/ui/live-page.ts:126-136
export function replaceHash(fragment: string): void {
  const url = new URL(location.href)
  url.hash = fragment
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`)
}

export function stripReturnParameters(): void {
  const url = new URL(location.href)
  let changed = false
  for (const name of RETURN_PARAMETERS) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name)
      changed = true
    }
  }
  if (changed) history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`)
}
