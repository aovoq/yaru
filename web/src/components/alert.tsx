import type { ComponentChildren } from "preact"
import { Button } from "./button"
import { IconButton } from "./icon-button"
import { CrossIcon } from "./icons/cross-icon"

// 保存や読み込みに失敗したことを伝える赤い知らせ。issue 画面と dashboard の本文の先頭に置く
// floating は issue 画面を開いていない板の上で、画面の右上に浮かせて出すとき。下の板と重なるので面は塗りつぶす
// 浮かせた知らせは板の操作の邪魔になるので、onDismiss を渡すと閉じるボタンを出す
// やり直せる失敗 (読み込みや保存) は、onRetry を渡すと Retry のボタンを出す

export function Alert({
  floating = false,
  onDismiss,
  onRetry,
  class: extra = "",
  children,
}: {
  floating?: boolean
  onDismiss?: () => void
  onRetry?: () => void
  class?: string
  children?: ComponentChildren
}) {
  const actions = onDismiss !== undefined || onRetry !== undefined
  return (
    <div
      role="alert"
      class={[
        "text-body rounded-md border border-semantic-danger/40 px-3 py-2 text-semantic-danger",
        floating
          ? "fixed top-14 right-3 left-3 z-40 bg-surface-1 shadow-lg shadow-black/50 sm:left-auto sm:max-w-md"
          : "bg-semantic-danger/10",
        actions ? "flex items-center gap-3" : "",
        extra,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {actions ? <p class="m-0 min-w-0 flex-1">{children}</p> : children}
      {onRetry ? (
        <Button type="button" variant="secondary" size="sm" class="shrink-0" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
      {onDismiss ? (
        <IconButton label="Dismiss" class="shrink-0" onClick={onDismiss}>
          <CrossIcon />
        </IconButton>
      ) : null}
    </div>
  )
}
