import { CheckIcon } from "../../components/icons/check-icon"
import { ChevronRightIcon } from "../../components/icons/chevron-right-icon"
import { Kbd } from "../../components/kbd"
import type { MenuItem as MenuItemData } from "../issue-menu"
import { MenuIconView } from "./menu-icon"

// メニューの 1 行のボタン。選ばれているか・子メニューが開いているかは親の MenuPanel が持ち、ここは見た目と役割だけを描く
// 印の付く項目は menuitemcheckbox、子メニューを開く項目は aria-haspopup で読み上げに伝える
// https://www.w3.org/WAI/ARIA/apg/patterns/menubar/

export function MenuItem({
  item,
  index,
  active,
  expanded,
  onPointerEnter,
  onClick,
}: {
  item: Exclude<MenuItemData, { kind: "separator" }>
  index: number
  active: boolean
  expanded: boolean
  onPointerEnter: () => void
  onClick: () => void
}) {
  const submenu = item.kind === "submenu"
  return (
    <button
      type="button"
      role={item.kind === "action" && item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
      aria-haspopup={submenu ? "menu" : undefined}
      aria-expanded={submenu ? expanded : undefined}
      aria-checked={item.kind === "action" && item.checked !== undefined ? item.checked : undefined}
      data-menu-index={index}
      data-active={active ? "" : undefined}
      onPointerEnter={onPointerEnter}
      onClick={onClick}
      class="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left font-sans text-[13px] text-ink-muted outline-none data-active:bg-hairline-strong data-active:text-ink"
    >
      <span class="grid w-4 shrink-0 place-items-center">
        {item.icon ? <MenuIconView icon={item.icon} /> : null}
      </span>
      <span class="min-w-0 flex-1 truncate">{item.label}</span>
      {item.kind === "action" && item.checked ? <CheckIcon /> : null}
      {item.kind === "action" && item.hint ? <Kbd variant="plain">{item.hint}</Kbd> : null}
      {submenu ? <ChevronRightIcon /> : null}
    </button>
  )
}
