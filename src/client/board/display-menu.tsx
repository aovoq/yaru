import { useCallback, useState } from "preact/hooks"
import { buttonClass } from "../../components/button"
import { SlidersIcon } from "../../components/icons/sliders-icon"
import { Popover } from "../../components/popover"
import type { PageFilters } from "../view-model"
import { DisplayOptions } from "./display-options"

// 見出しの帯の Display。issue のまとまり (group)・並べ方 (sort)・終わった issue の見せ方 (completed) を選ぶ面を開く
// 面の中身は display-options.tsx が持つ。ここは開閉だけを受け持つ
// スマホ幅では Display のボタンが画面の中ほどにあり、右端にそろえた面が左へはみ出すので、面を画面の幅に広げて見出しの帯のすぐ下に置く

export function DisplayMenu({ filters }: { filters: PageFilters }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <Popover
      open={open}
      onClose={close}
      align="end"
      class="max-sm:fixed max-sm:inset-x-4 max-sm:top-[calc(env(safe-area-inset-top)+3.25rem)]"
      trigger={
        <button
          id="display-menu"
          type="button"
          aria-label="Display options"
          aria-haspopup="dialog"
          aria-expanded={open ? "true" : "false"}
          onClick={() => setOpen(!open)}
          class={buttonClass("secondary", "sm", "shrink-0")}
        >
          <SlidersIcon />
          <span class="hidden lg:inline">Display</span>
        </button>
      }
    >
      <DisplayOptions filters={filters} />
    </Popover>
  )
}
