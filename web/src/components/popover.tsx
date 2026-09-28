import type { ComponentChildren } from "preact"
import { useEffect, useRef } from "preact/hooks"

// 押した部品 (trigger) のすぐ下に開く小さな面。状態や担当者などの選択 (Combobox) を中に置いて使う
// 開閉の状態は呼ぶ側が持ち、trigger を押したときに open を切り替える。trigger と面は同じ枠 (data-popover-root) に入れ、
// 枠の外を押したら onClose を呼ぶ。trigger を押しても外を押したことにはならないので、開いたまま押すと trigger の側で閉じられる
// Esc で閉じたときと、中で選んで閉じたときは trigger へ focus を戻す。面ごと focus が消えて body に落ち、
// キーボードで操作していた場所を見失わないため
// Esc は面の中で止め、板の Esc (issue を閉じる) まで届かせない
// 見た目は右クリックのメニュー (client/context-menu/menu-panel.tsx) の面にそろえる
// https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

export type PopoverAlign = "start" | "end"

export function Popover({
  open,
  onClose,
  trigger,
  align = "start",
  class: extra = "",
  children,
}: {
  open: boolean
  onClose: () => void
  trigger: ComponentChildren
  // 面を trigger の左端 (start) と右端 (end) のどちらにそろえるか。画面の右端に近い trigger は end にする
  align?: PopoverAlign
  class?: string
  children?: ComponentChildren
}) {
  const root = useRef<HTMLSpanElement | null>(null)
  const triggerSlot = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && root.current?.contains(target)) return
      onClose()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [open, onClose])

  const focusTrigger = () =>
    triggerSlot.current
      ?.querySelector<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")
      ?.focus()

  // 開いていた面が閉じて focus が body に落ちていたら trigger へ戻す。外を押して閉じたときは押した先に focus があるので動かさない
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open) {
      const active = document.activeElement
      if (active === null || active === document.body) focusTrigger()
    }
    wasOpen.current = open
  }, [open])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    onClose()
    focusTrigger()
  }

  return (
    <span ref={root} data-popover-root="" class="relative inline-flex">
      <span ref={triggerSlot} class="contents">
        {trigger}
      </span>
      {open ? (
        <div
          data-popover=""
          onKeyDown={onKeyDown}
          class={[
            "text-body absolute top-full z-50 mt-1 min-w-52 rounded-xl border border-hairline-strong bg-surface-3 p-1 shadow-2xl shadow-black/60",
            align === "end" ? "right-0" : "left-0",
            extra,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {children}
        </div>
      ) : null}
    </span>
  )
}
