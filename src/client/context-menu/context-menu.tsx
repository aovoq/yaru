import { useEffect } from "preact/hooks"
import type { MenuAction, MenuItem } from "../issue-menu"
import { MenuPanel } from "./menu-panel"

// 右クリックで開くメニューの入口。項目を選ぶと閉じてから操作を渡す
// 外を押す・画面を動かす・ウィンドウを離れると閉じる。面の中のキーボード操作は MenuPanel が受け持つ
// https://www.w3.org/WAI/ARIA/apg/patterns/menubar/

export type OpenMenu = { items: MenuItem[]; x: number; y: number }

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
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("resize", close)
    window.addEventListener("blur", close)
    document.addEventListener("scroll", close, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("blur", close)
      document.removeEventListener("scroll", close, true)
    }
  }, [onClose])
  return (
    <MenuPanel
      items={menu.items}
      anchor={{ x: menu.x, y: menu.y }}
      onAction={(action) => {
        onClose()
        onAction(action)
      }}
      onEscape={onClose}
    />
  )
}
