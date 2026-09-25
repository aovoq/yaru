import type { ComponentChildren } from "preact"

// 保存や読み込みに失敗したことを伝える赤い知らせ。issue 画面と dashboard の本文の先頭に置く
// floating は issue 画面を開いていない板の上で、画面の右上に浮かせて出すとき。下の板と重なるので面は塗りつぶす

export function Alert({
  floating = false,
  class: extra = "",
  children,
}: {
  floating?: boolean
  class?: string
  children?: ComponentChildren
}) {
  return (
    <p
      role="alert"
      class={[
        "rounded-md border border-semantic-danger/40 px-3 py-2 text-[13px] text-semantic-danger",
        floating ? "fixed top-0 right-0 z-20 bg-surface-1" : "bg-semantic-danger/10",
        extra,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </p>
  )
}
