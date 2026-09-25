import type { ComponentChildren } from "preact"
import { useEffect, useRef } from "preact/hooks"

// 画面の上に重ねて、答えるまで下を触らせない面 (コマンドパレット、「変更を捨てるか」の確認)
// 下の画面を触らせないために、背景の幕を押すと閉じ、Esc は面の中で止めて onClose を呼ぶ (板の Esc で issue を閉じるまで届かせない)
// 開いたときの focus は中身 (検索欄やボタン) が autofocus で決め、閉じたら開く前に focus のあった場所へ戻す
// Tab で面の外へ出ないようにする仕組み (focus trap) は持たない。下の画面を inert にするのは呼ぶ側が行う
// https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

export type DialogPlacement = "top" | "center"

export function Dialog({
  label,
  describedBy,
  role = "dialog",
  placement = "center",
  onClose,
  class: extra = "",
  children,
}: {
  // 読み上げの名前
  label: string
  // 説明の文の id (aria-describedby)。確認の面で、何を捨てるのかを名前と一緒に読み上げる
  describedBy?: string
  // 確認のように、答えを求めて止める面は alertdialog にする
  role?: "dialog" | "alertdialog"
  // top は検索の結果で高さが変わる面 (コマンドパレット) を、上の位置をそろえて出すとき
  placement?: DialogPlacement
  onClose: () => void
  class?: string
  children?: ComponentChildren
}) {
  const opener = useRef<Element | null>(null)
  if (opener.current === null && typeof document !== "undefined") {
    opener.current = document.activeElement
  }

  useEffect(() => {
    const previous = opener.current
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  return (
    <div
      data-dialog=""
      class={[
        "fixed inset-0 z-50 flex justify-center bg-black/60 px-4",
        placement === "top" ? "items-start pt-[12vh]" : "items-center",
      ].join(" ")}
      onPointerDown={(event: PointerEvent) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        class={[
          "w-full rounded-xl border border-hairline-strong bg-surface-3 shadow-2xl shadow-black/60",
          extra,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </div>
  )
}
