import { useId, useLayoutEffect, useRef, useState } from "preact/hooks"
import { clampMenuPosition, type MenuAction, type MenuItem as MenuItemData } from "../issue-menu"
import { MenuItem } from "./menu-item"

// メニューの 1 枚の面。項目を並べ、キーボードでの移動と子メニューの開閉を受け持つ。子メニューは同じ部品で入れ子に描く
// ↑↓ で移動、→ と ↵ で子メニューを開くか実行、← で親へ戻る、Esc で親へ戻るか閉じる
// キーボードで子メニューを開いたときは、その最初の項目を選んだ状態から始める (APG の menu の型)
// focus は面 (role=menu) に置いたまま、選んでいる項目を aria-activedescendant で伝える。押せない項目 (aria-disabled) は飛ばす
// https://www.w3.org/WAI/ARIA/apg/patterns/menubar/

export function MenuPanel({
  items,
  anchor,
  side = "right",
  activateFirst = false,
  label,
  onAction,
  onEscape,
  onBack,
}: {
  items: MenuItemData[]
  anchor: { x: number; y: number }
  side?: "right" | "left"
  // 開いたときに最初の項目を選んでおくか。キーボードで開いた子メニューで使う
  activateFirst?: boolean
  // 読み上げの名前。子メニューは開いた項目の名前 (Status など)
  label?: string
  onAction: (action: MenuAction) => void
  onEscape: () => void
  onBack?: () => void
}) {
  const panelId = useId()
  const panel = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(anchor)
  const selectable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind !== "separator" && !(item.kind === "action" && item.disabled))
  const [activeIndex, setActiveIndex] = useState(() =>
    activateFirst ? (selectable[0]?.index ?? -1) : -1,
  )
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [submenuAnchor, setSubmenuAnchor] = useState<{
    x: number
    y: number
    side: "right" | "left"
    activateFirst: boolean
  } | null>(null)
  const itemId = (index: number) => `${panelId}-item-${index}`

  // 描いてから大きさを測り、画面からはみ出さない位置に置き直す。子メニューは右に出せなければ左に出す
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const size = { width: element.offsetWidth, height: element.offsetHeight }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const x = side === "left" ? anchor.x - size.width : anchor.x
    setPosition(clampMenuPosition({ x, y: anchor.y }, size, viewport))
    element.focus()
  }, [anchor.x, anchor.y, side])

  const openSubmenu = (index: number, byKeyboard: boolean) => {
    const row = panel.current?.querySelector<HTMLElement>(`[data-menu-index="${index}"]`)
    if (!row) return
    const rect = row.getBoundingClientRect()
    const fitsRight = rect.right + 220 < window.innerWidth
    setOpenIndex(index)
    setSubmenuAnchor({
      x: fitsRight ? rect.right - 4 : rect.left + 4,
      y: rect.top - 4,
      side: fitsRight ? "right" : "left",
      activateFirst: byKeyboard,
    })
  }

  const activate = (index: number, byKeyboard: boolean) => {
    const item = items[index]
    if (!item || item.kind === "separator") return
    if (item.kind === "submenu") {
      openSubmenu(index, byKeyboard)
      return
    }
    if (item.disabled || !item.action) return
    onAction(item.action)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== panel.current) return
    event.stopPropagation()
    const position = selectable.findIndex(({ index }) => index === activeIndex)
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      const next = selectable[(position + step + selectable.length) % selectable.length]
      if (next) setActiveIndex(next.index)
      return
    }
    if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      if (activeIndex < 0) return
      if (event.key === "ArrowRight" && items[activeIndex]?.kind !== "submenu") return
      activate(activeIndex, true)
      return
    }
    if (event.key === "ArrowLeft" && onBack) {
      event.preventDefault()
      onBack()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      if (onBack) onBack()
      else onEscape()
    }
  }

  const openItem = openIndex !== null ? items[openIndex] : undefined
  return (
    <>
      <div
        ref={panel}
        role="menu"
        aria-label={label}
        aria-activedescendant={activeIndex >= 0 ? itemId(activeIndex) : undefined}
        tabindex={-1}
        data-context-menu=""
        onKeyDown={onKeyDown}
        onContextMenu={(event: MouseEvent) => event.preventDefault()}
        style={`left: ${position.x}px; top: ${position.y}px`}
        class="text-body fixed z-50 min-w-52 rounded-lg border border-hairline-strong bg-surface-3 p-1 shadow-2xl shadow-black/60 outline-none"
      >
        {items.map((item, index) =>
          item.kind === "separator" ? (
            <div role="separator" class="mx-1 my-1 h-px bg-hairline" />
          ) : (
            <MenuItem
              item={item}
              id={itemId(index)}
              index={index}
              active={activeIndex === index || openIndex === index}
              expanded={openIndex === index}
              onPointerEnter={() => {
                if (item.kind === "action" && item.disabled) return
                setActiveIndex(index)
                if (item.kind === "submenu") openSubmenu(index, false)
                else setOpenIndex(null)
              }}
              onClick={() => activate(index, false)}
            />
          ),
        )}
      </div>
      {openItem?.kind === "submenu" && submenuAnchor ? (
        <MenuPanel
          key={openIndex}
          items={openItem.items}
          anchor={{ x: submenuAnchor.x, y: submenuAnchor.y }}
          side={submenuAnchor.side}
          activateFirst={submenuAnchor.activateFirst}
          label={openItem.label}
          onAction={onAction}
          onEscape={onEscape}
          onBack={() => {
            setOpenIndex(null)
            panel.current?.focus()
          }}
        />
      ) : null}
    </>
  )
}
