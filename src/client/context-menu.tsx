import { useEffect, useLayoutEffect, useRef, useState } from "hono/jsx"
import { PriorityIcon, StatusIcon } from "./icons"
import { clampMenuPosition, type MenuAction, type MenuIcon, type MenuItem } from "./issue-menu"
import { Avatar, LabelDot } from "./issue-metadata"

// 右クリックで開くメニュー。子メニューはマウスを載せるか → で開き、↑↓ で移動、↵ で実行、← と Esc で戻る
// 外を押す・画面を動かす・ウィンドウを離れると閉じる
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

function MenuPanel({
  items,
  anchor,
  side = "right",
  onAction,
  onEscape,
  onBack,
}: {
  items: MenuItem[]
  anchor: { x: number; y: number }
  side?: "right" | "left"
  onAction: (action: MenuAction) => void
  onEscape: () => void
  onBack?: () => void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(anchor)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [submenuAnchor, setSubmenuAnchor] = useState<{
    x: number
    y: number
    side: "right" | "left"
  } | null>(null)

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

  const selectable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind !== "separator")

  const openSubmenu = (index: number) => {
    const row = panel.current?.querySelector<HTMLElement>(`[data-menu-index="${index}"]`)
    if (!row) return
    const rect = row.getBoundingClientRect()
    const fitsRight = rect.right + 220 < window.innerWidth
    setOpenIndex(index)
    setSubmenuAnchor({
      x: fitsRight ? rect.right - 4 : rect.left + 4,
      y: rect.top - 4,
      side: fitsRight ? "right" : "left",
    })
  }

  const activate = (index: number) => {
    const item = items[index]
    if (!item || item.kind === "separator") return
    if (item.kind === "submenu") {
      openSubmenu(index)
      return
    }
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
      activate(activeIndex)
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
        tabindex={-1}
        data-context-menu=""
        onKeyDown={onKeyDown}
        onContextMenu={(event: MouseEvent) => event.preventDefault()}
        style={`left: ${position.x}px; top: ${position.y}px`}
        class="fixed z-50 min-w-52 rounded-lg border border-hairline-strong bg-surface-3 p-1 text-[13px] shadow-2xl shadow-black/60 outline-none"
      >
        {items.map((item, index) =>
          item.kind === "separator" ? (
            <div role="separator" class="mx-1 my-1 h-px bg-hairline" />
          ) : (
            <button
              type="button"
              role={
                item.kind === "submenu"
                  ? "menuitem"
                  : item.checked === undefined
                    ? "menuitem"
                    : "menuitemcheckbox"
              }
              aria-haspopup={item.kind === "submenu" ? "menu" : undefined}
              aria-expanded={item.kind === "submenu" ? String(openIndex === index) : undefined}
              aria-checked={
                item.kind === "action" && item.checked !== undefined
                  ? String(item.checked)
                  : undefined
              }
              data-menu-index={index}
              data-active={activeIndex === index || openIndex === index ? "" : undefined}
              onPointerEnter={() => {
                setActiveIndex(index)
                if (item.kind === "submenu") openSubmenu(index)
                else setOpenIndex(null)
              }}
              onClick={() => activate(index)}
              class="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left font-sans text-[13px] text-ink-muted outline-none data-active:bg-hairline-strong data-active:text-ink"
            >
              <span class="grid w-4 shrink-0 place-items-center">
                {item.icon ? <MenuIconView icon={item.icon} /> : null}
              </span>
              <span class="min-w-0 flex-1 truncate">{item.label}</span>
              {item.kind === "action" && item.checked ? <CheckIcon /> : null}
              {item.kind === "action" && item.hint ? (
                <span class="font-mono text-[11px] text-ink-tertiary">{item.hint}</span>
              ) : null}
              {item.kind === "submenu" ? <ChevronRightIcon /> : null}
            </button>
          ),
        )}
      </div>
      {openItem?.kind === "submenu" && submenuAnchor ? (
        <MenuPanel
          items={openItem.items}
          anchor={{ x: submenuAnchor.x, y: submenuAnchor.y }}
          side={submenuAnchor.side}
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

// コピーなど、結果が画面に出ない操作を終えたことを短く知らせる
export function Notice({ text }: { text: string }) {
  return (
    <p
      role="status"
      class="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-hairline-strong bg-surface-3 px-3 py-1.5 text-[12px] text-ink shadow-lg shadow-black/50"
    >
      {text}
    </p>
  )
}

function MenuIconView({ icon }: { icon: MenuIcon }) {
  if (icon.kind === "status") return <StatusIcon status={icon.status} />
  if (icon.kind === "priority") return <PriorityIcon priority={icon.priority} />
  if (icon.kind === "avatar") return <Avatar name={icon.name} />
  return <LabelDot label={icon.label} />
}

function CheckIcon() {
  return (
    <svg class="size-3.5 shrink-0 text-ink" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3 7.4l2.6 2.6L11 4.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg class="size-3 shrink-0 text-ink-tertiary" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
