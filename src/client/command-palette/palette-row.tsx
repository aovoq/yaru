import { MenuIconView } from "../context-menu/menu-icon"
import type { PaletteEntry } from "./palette-entries"

// コマンドパレットの候補の 1 行。focus は検索欄に置いたままにし、選んでいる行は aria-activedescendant で伝えるので、行は focus を取らない
// https://www.w3.org/WAI/ARIA/apg/patterns/combobox/

export function PaletteRow({
  entry,
  id,
  active,
  onPointerMove,
  onChoose,
}: {
  entry: PaletteEntry
  id: string
  active: boolean
  onPointerMove: () => void
  onChoose: () => void
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active ? "true" : "false"}
      data-active={active ? "" : undefined}
      // 押しても検索欄から focus を離さない。離れると ↑↓ と Enter が効かなくなるため
      onMouseDown={(event) => event.preventDefault()}
      onPointerMove={onPointerMove}
      onClick={onChoose}
      class="text-body flex h-9 w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-3 text-ink-muted data-active:bg-hairline-strong data-active:text-ink"
    >
      <span class="grid w-4 shrink-0 place-items-center">
        {entry.icon ? <MenuIconView icon={entry.icon} /> : null}
      </span>
      <span class="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.detail ? (
        <span class="text-small shrink-0 font-mono text-ink-tertiary">{entry.detail}</span>
      ) : null}
    </div>
  )
}
