import { buttonClass } from "../components/button"
import { HIT_AREA_ICON_TOUCH } from "../components/hit-area"
import { CommandIcon } from "../components/icons/command-icon"
import { Kbd } from "../components/kbd"
import { useIssueActions } from "./context-menu/issue-actions"

// 見出しの帯に置く、⌘K のコマンドパレットの入口。キーボードの無いスマホでも issue を探す・操作するところへ行けるようにする
// 広い画面 (lg 以上) では近道のキーを添え、スマホ幅では帯が狭いのでアイコンだけにする
// パレットを開く口 (openCommandPalette) が無いとき (サーバーだけで描く画面など) は置かない

export function CommandPaletteButton() {
  const { openCommandPalette } = useIssueActions()
  if (!openCommandPalette) return null
  return (
    <button
      id="command-palette-open"
      type="button"
      aria-label="Command menu"
      aria-keyshortcuts="Meta+K"
      title="Command menu (⌘K)"
      onClick={openCommandPalette}
      class={buttonClass("ghost", "sm", `shrink-0 px-1.5 ${HIT_AREA_ICON_TOUCH}`)}
    >
      <CommandIcon />
      <span class="hidden lg:inline">
        <Kbd>⌘K</Kbd>
      </span>
    </button>
  )
}
