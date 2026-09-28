import { useEffect, useRef } from "preact/hooks"

// issue 画面を開いたときに focus を中へ移し、閉じたら開く前の板の行へ戻す
// 開いている間もサイドバーは使えるので modal ではない。移し方は modal の dialog にならう
// https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
// 移すのは開いた issue が変わったときだけにする。読み直しのたびに移すと、打っている欄から focus を奪うため

export function useDialogFocus(issueId: string): void {
  const lastIssueId = useRef(issueId)
  lastIssueId.current = issueId

  useEffect(() => {
    const dialog = document.getElementById("issue-view")
    if (!dialog) return
    const active = document.activeElement
    if (!issueId) {
      const title = dialog.querySelector<HTMLTextAreaElement>('textarea[name="title"]')
      if (title && active !== title) title.focus()
      return
    }
    if (active && active !== document.body && dialog.contains(active)) return
    dialog.focus()
  }, [issueId])

  useEffect(
    () => () => {
      const closedIssueId = lastIssueId.current
      if (!closedIssueId) return
      requestAnimationFrame(() => {
        const row = [...document.querySelectorAll<HTMLElement>("[data-id]")].find(
          (element) =>
            element.dataset.id === closedIssueId &&
            !element.closest("#issue-view") &&
            !element.closest("[inert]"),
        )
        row?.focus()
      })
    },
    [],
  )
}
