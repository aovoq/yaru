import { useEffect, useRef } from "preact/hooks"

// issue 画面 (dialog) を開いたときに focus を中へ移し、閉じたら開く前の板の行へ戻す
// 開いている間もサイドバーは使えるので modal ではないが、開いた直後に打てるよう focus の移し方は modal の dialog にならう
// https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
// 新しい issue は題名の欄へ、既にある issue は dialog そのもの (tabindex="-1") へ移す。読み上げは dialog の名前 (題名) から読む
// 移すのは開いた issue が変わったときだけにする。板の読み直し (自動保存や他の人の書き込み) のたびに移すと、打っている欄から focus を奪うため
// 既にある issue へ移るとき、focus が既に dialog の中にあれば動かさない (新しい issue を作って番号が付いたとき、題名の欄で打ち続けられるように)
// 新しい issue へ移るときは、focus が dialog の中にあっても題名の欄へ移す。コマンドパレットやメニューは閉じるときに focus を
// 開く前の場所 (いまの issue の dialog) へ戻すので、そこから新しい issue を作ると題名に打てないままになるため
// autofocus はページを読み込んだときにしか効かないので、ページを読み直さずに開いたときのためにここで移す
// 閉じたときは、描き直しが終わってから板の同じ issue の行へ戻す。dialog の中の子 issue の一覧にも data-id があるのでそれは除き、
// dialog を開いている間に板に付けた inert が外れる前だと focus できないので、次の画面の更新まで待つ

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
