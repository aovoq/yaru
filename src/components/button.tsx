import type { JSX } from "preact"

// 画面のボタンの見た目をそろえる。種類 (variant)・大きさ (size)・寄せ方 (align)・カーソル (cursor) だけを選び、クラスを直接並べない
// size は md がスマホで押しやすい高さ (36px)、sm が一覧や見出しに置く小さい高さ (28px)、
// xs が属性の行の中に置く小さな文字のボタン、inline が枠も余白も高さも持たず、字の大きさも周りに合わせるボタン
// variant の text (薄い色) と plain (本文の色) は、「Add description…」や属性の値のように文字だけで押せるボタンに使う

export type ButtonVariant = "primary" | "secondary" | "ghost" | "text" | "plain"
export type ButtonSize = "sm" | "md" | "xs" | "inline"
export type ButtonAlign = "center" | "start"
export type ButtonCursor = "pointer" | "text"

const BASE =
  "inline-flex items-center gap-1.5 rounded-md font-sans no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-focus/50 disabled:cursor-default disabled:opacity-50"

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-0 bg-primary font-medium text-on-primary hover:bg-primary-hover active:bg-primary-focus",
  secondary:
    "border border-hairline bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
  ghost: "border-0 bg-transparent text-ink-subtle hover:bg-surface-2 hover:text-ink",
  text: "border-0 bg-transparent p-0 text-ink-tertiary hover:text-ink-subtle",
  plain: "border-0 bg-transparent p-0 text-ink",
}

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-xs",
  md: "h-9 px-3 text-[13px]",
  xs: "px-1 text-[11px]",
  inline: "",
}

const ALIGNS: Record<ButtonAlign, string> = {
  center: "justify-center",
  start: "justify-start text-left",
}

const CURSORS: Record<ButtonCursor, string> = {
  pointer: "cursor-pointer",
  text: "cursor-text",
}

export function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize,
  extra = "",
  options: { align?: ButtonAlign; cursor?: ButtonCursor } = {},
): string {
  return [
    BASE,
    VARIANTS[variant],
    SIZES[size],
    ALIGNS[options.align ?? "center"],
    CURSORS[options.cursor ?? "pointer"],
    extra,
  ]
    .filter(Boolean)
    .join(" ")
}

export function Button({
  variant = "secondary",
  size = "sm",
  align,
  cursor,
  class: extra = "",
  type = "button",
  ...props
}: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  align?: ButtonAlign
  cursor?: ButtonCursor
  class?: string
}) {
  return (
    <button {...props} type={type} class={buttonClass(variant, size, extra, { align, cursor })} />
  )
}
