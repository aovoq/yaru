import { useLayoutEffect } from "preact/hooks"
import type { PageController } from "./use-page-controller"
import { newIssueHref, pageHref, type PageFilters } from "./view-model"

// 板のキーボード操作をまとめる。新規作成・検索・選択の移動・開閉・メニューを document の keydown で受ける
// 選んだ issue が画面の外にあれば、見える位置まで送る

export function useKeyboardShortcuts(
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
      const nextId = issueIds[nextIndex] ?? null
      controller.selectIssue(nextId)
      // j / k で選んだ行だけを見える位置まで送る。右クリックで選んだときに送ると、
      // issue 画面の裏の一覧が動き、その scroll で開いたばかりのメニューが閉じてしまう
      if (nextId) {
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`#board [data-id="${CSS.escape(nextId)}"]`)
            ?.scrollIntoView({ block: "nearest" })
        })
      }
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
}
