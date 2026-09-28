import type { JSX } from "preact"
import { HIT_AREA } from "./hit-area"

// 画面のボタンの見た目をそろえる。種類 (variant)・大きさ (size)・寄せ方 (align)・カーソル (cursor) だけを選び、クラスを直接並べない
// size は md が画面の主な操作に使う高さ (sm の幅より狭い画面では指で押しやすい 44px、広い画面では 36px)、sm が一覧や見出しに置く小さい高さ (28px)、
// xs が属性の行の中に置く小さな文字のボタン、inline が枠も余白も高さも持たず、字の大きさも周りに合わせるボタン
// inline は余白を持たないので、地の色や枠のある種類と組むと字が縁に触れてはみ出して見える。字だけの種類 (text・plain) とだけ組める
// variant の text (薄い色) と plain (本文の色) は、「Add description…」や属性の値のように文字だけで押せるボタンに使う
// 44px は Apple の Human Interface Guidelines の押せる大きさ https://developer.apple.com/design/human-interface-guidelines/accessibility#Buttons-and-controls

export type ButtonVariant = "primary" | "secondary" | "ghost" | "text" | "plain"
export type ButtonSize = "sm" | "md" | "xs" | "inline"
export type InlineButtonVariant = "text" | "plain"
export type BoxButtonSize = Exclude<ButtonSize, "inline">
export type ButtonAlign = "center" | "start"
export type ButtonCursor = "pointer" | "text"

// focus の枠は地に対して 6:1 以上ある primary-hover を不透明のまま使う (focus-ring.ts と同じ理由)
const BASE =
  "inline-flex items-center gap-1.5 font-sans no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-hover disabled:cursor-default disabled:opacity-50"

export const INLINE_VARIANTS: readonly InlineButtonVariant[] = ["text", "plain"]

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-0 bg-primary font-medium text-on-primary hover:bg-primary-hover active:bg-primary-focus",
  secondary:
    "border border-hairline bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
  ghost: "border-0 bg-transparent text-ink-subtle hover:bg-surface-2 hover:text-ink",
  text: "border-0 bg-transparent p-0 text-ink-tertiary hover:text-ink-subtle",
  plain: "border-0 bg-transparent p-0 text-ink",
}

// 角の丸みは大きさで決める。字だけの小さいボタンに md の丸みを付けると、focus の枠が楕円に見えてしまう
const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 rounded-md px-3 text-small",
  md: "h-11 rounded-md px-3 text-body sm:h-9",
  xs: "rounded-xs px-1 text-micro",
  inline: "rounded-xs",
}

// 字だけのボタンは字の高さ (16px 前後) しかなく押しそこねやすいので、押せる範囲だけを広げる (hit-area.ts)
function needsHitArea(variant: ButtonVariant, size: ButtonSize): boolean {
  return size === "xs" || size === "inline" || variant === "text" || variant === "plain"
}

const ALIGNS: Record<ButtonAlign, string> = {
  center: "justify-center",
  start: "justify-start text-left",
}

const CURSORS: Record<ButtonCursor, string> = {
  pointer: "cursor-pointer",
  text: "cursor-text",
}

type ButtonClassOptions = { align?: ButtonAlign; cursor?: ButtonCursor }

// 種類と大きさの組み合わせ。inline は字だけの種類とだけ組める
export type ButtonAppearance =
  | { variant?: ButtonVariant; size?: BoxButtonSize }
  | { variant: InlineButtonVariant; size: "inline" }

export function buttonClass(
  variant: InlineButtonVariant,
  size: "inline",
  extra?: string,
  options?: ButtonClassOptions,
): string
export function buttonClass(
  variant: ButtonVariant,
  size: BoxButtonSize,
  extra?: string,
  options?: ButtonClassOptions,
): string
export function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize,
  extra = "",
  options: ButtonClassOptions = {},
): string {
  return classesFor(variant, size, extra, options)
}

// 組み合わせの確かめは buttonClass と ButtonAppearance の型が受け持つので、ここは広い引数のままクラスを並べる
function classesFor(
  variant: ButtonVariant,
  size: ButtonSize,
  extra: string,
  options: ButtonClassOptions,
): string {
  return [
    BASE,
    VARIANTS[variant],
    SIZES[size],
    needsHitArea(variant, size) ? HIT_AREA : "",
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
}: JSX.ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonAppearance & {
    align?: ButtonAlign
    cursor?: ButtonCursor
    class?: string
  }) {
  return (
    <button {...props} type={type} class={classesFor(variant, size, extra, { align, cursor })} />
  )
}
