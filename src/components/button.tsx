import type { JSX } from "preact"

// 画面のボタンの見た目をそろえる。種類 (variant) と大きさ (size) だけを選び、クラスを直接並べない
// size は md がスマホで押しやすい高さ (36px)、sm が一覧や見出しに置く小さい高さ (28px)

export type ButtonVariant = "primary" | "secondary" | "ghost"
export type ButtonSize = "sm" | "md"

const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-sans no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-focus/50 disabled:cursor-default disabled:opacity-50"

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-0 bg-primary font-medium text-on-primary hover:bg-primary-hover active:bg-primary-focus",
  secondary:
    "border border-hairline bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
  ghost: "border-0 bg-transparent text-ink-subtle hover:bg-surface-2 hover:text-ink",
}

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-xs",
  md: "h-9 px-3 text-[13px]",
}

export function buttonClass(variant: ButtonVariant, size: ButtonSize, extra = ""): string {
  return [BASE, VARIANTS[variant], SIZES[size], extra].filter(Boolean).join(" ")
}

export function Button({
  variant = "secondary",
  size = "sm",
  class: extra = "",
  type = "button",
  ...props
}: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  class?: string
}) {
  return <button {...props} type={type} class={buttonClass(variant, size, extra)} />
}
