import { useEffect } from "preact/hooks"
import type { MenuAction, MenuItem } from "../issue-menu"
import { MenuPanel } from "./menu-panel"

// 右クリックで開くメニューの入口。項目を選ぶと閉じてから操作を渡す
// 外を押す・画面を動かす・ウィンドウを離れると閉じる。面の中のキーボード操作は MenuPanel が受け持つ
// Esc か項目を選んで閉じたときは、開く前に focus のあった場所 (行や「…」のボタン) へ focus を戻す
// 面ごと focus が消えて body に落ちると、キーボードで続けて j / k やメニューを使えなくなるため
// 外を押して閉じたときは、押した先に focus が移るので戻さない
// https://www.w3.org/WAI/ARIA/apg/patterns/menubar/

export type OpenMenu = {
  items: MenuItem[]
  x: number
  y: number
  // 閉じたときに focus を戻す要素
  returnFocus?: HTMLElement | null
}

export function ContextMenu({
  menu,
  onAction,
  onClose,
}: {
  menu: OpenMenu
  onAction: (action: MenuAction) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-context-menu]")) return
      onClose()
    }
    const close = () => onClose()
    // メニューの中で起きた scroll (長い一覧を送ったとき) では閉じない
    const onScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-context-menu]")) return
      onClose()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("resize", close)
    window.addEventListener("blur", close)
    document.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("blur", close)
      document.removeEventListener("scroll", onScroll, true)
    }
  }, [onClose])
  const returnFocus = () => menu.returnFocus?.focus({ preventScroll: true })
  return (
    <MenuPanel
      items={menu.items}
      anchor={{ x: menu.x, y: menu.y }}
      label="Issue actions"
      onAction={(action) => {
        onClose()
        returnFocus()
        onAction(action)
      }}
      onEscape={() => {
        onClose()
        returnFocus()
      }}
    />
  )
}
