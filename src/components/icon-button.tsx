import type { ComponentChildren, JSX } from "preact"
import { FOCUS_RING } from "./focus-ring"

// 文字を持たずアイコンだけで押させる四角いボタン。サイドバーの開閉、issue 画面を閉じる、板の列の新規作成で使う
// sm は見出しの帯に置く 28px、xs は板の列の見出しに置く 20px
// 見た目を直接使う場所 (header.tsx の最初は隠しておくサイドバーを開くボタン) のためにクラスの関数も出す

export type IconButtonSize = "sm" | "xs"

const SIZES: Record<IconButtonSize, string> = {
  sm: "size-7 shrink-0 rounded-md transition-colors",
  // 板の列の + は見出しに hover したときだけ opacity で現れるので、色と opacity の両方を動かす transition にする
  xs: "size-5 rounded transition",
}

export function iconButtonClass(size: IconButtonSize = "sm", extra = ""): string {
  // hidden を渡されたときは grid を付けない。同じ display のクラスが 2 つあると、どちらが勝つかが CSS の並び順で決まってしまうため
  const hidden = extra.split(/\s+/).includes("hidden")
  return [
    hidden ? "" : "grid",
    "place-items-center text-ink-tertiary no-underline hover:bg-surface-2 hover:text-ink",
    SIZES[size],
    FOCUS_RING,
    extra,
  ]
    .filter(Boolean)
    .join(" ")
}

type IconButtonProps = {
  // 見えない名前。title (hover で出る説明) と aria-label の両方に入れる
  label: string
  href?: string
  size?: IconButtonSize
  class?: string
  children?: ComponentChildren
}

export function IconButton({
  label,
  href,
  size = "sm",
  class: extra = "",
  children,
  ...rest
}: IconButtonProps &
  Omit<JSX.HTMLAttributes<HTMLElement>, "size" | "class" | "children" | "label">) {
  const className = iconButtonClass(size, extra)
  if (href !== undefined) {
    return (
      <a
        {...(rest as JSX.HTMLAttributes<HTMLAnchorElement>)}
        href={href}
        title={label}
        aria-label={label}
        class={className}
      >
        {children}
      </a>
    )
  }
  return (
    <button
      {...(rest as JSX.HTMLAttributes<HTMLButtonElement>)}
      type="button"
      title={label}
      aria-label={label}
      class={className}
    >
      {children}
    </button>
  )
}
