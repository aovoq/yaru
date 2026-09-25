import type { ComponentChildren } from "preact"
import { ChevronIcon } from "../../components/icons/chevron-icon"

// issue 画面の属性欄の部品。行・select・入力の見た目をまとめる
// 題名や説明の伸びる textarea は components/auto-grow-textarea.tsx、担当者なしの丸は components/empty-avatar.tsx にある

// 属性欄の入力と select に共通の見た目
export const FIELD =
  "h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 font-sans text-[13px] text-ink transition-colors placeholder:text-ink-tertiary hover:bg-surface-2 focus-visible:border-hairline-strong focus-visible:bg-surface-2 focus-visible:outline-none"

// 1 行の入力欄では Enter で入力を終え、離れたときの保存に任せる
// IME の変換を確定する Enter では離れない
export function blurOnEnter(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).blur()
}

// 属性欄の 1 行。左に項目名、右に値の入力を置き、値の前にアイコンを添えられる
export function PropRow({
  label,
  icon,
  children,
}: {
  label: string
  icon?: ComponentChildren
  children?: ComponentChildren
}) {
  return (
    <label class="flex min-h-8 items-start gap-2">
      <span class="flex h-7 w-20 shrink-0 items-center text-[12px] text-ink-tertiary">{label}</span>
      <span class="flex min-w-0 flex-1 items-start">
        {icon ? <span class="flex h-7 shrink-0 items-center pl-2">{icon}</span> : null}
        {children}
      </span>
    </label>
  )
}

// 選んだ値は change で受ける。select は 1 回の変更で input と change の両方を出すので、片方だけにする
export function SelectBox({
  name,
  value,
  onChange,
  children,
}: {
  name: string
  value: string
  onChange: (event: Event) => void
  children?: ComponentChildren
}) {
  return (
    <div class="relative w-full min-w-0">
      <select name={name} value={value} onChange={onChange} class={`${FIELD} appearance-none pr-7`}>
        {children}
      </select>
      <span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-tertiary">
        <ChevronIcon />
      </span>
    </div>
  )
}
