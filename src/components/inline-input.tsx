import type { JSX } from "preact"

// 枠を見せずに値を並べておき、hover と focus で初めて面が出る入力欄。issue 画面の属性欄 (担当者・ラベル・期限・親・止めている issue) で使う
// select の InlineSelect も同じ見た目にそろえる

export function inlineFieldClass(extra = ""): string {
  return [
    "h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 font-sans text-[13px] text-ink transition-colors placeholder:text-ink-tertiary hover:bg-surface-2 focus-visible:border-hairline-strong focus-visible:bg-surface-2 focus-visible:outline-none",
    extra,
  ]
    .filter(Boolean)
    .join(" ")
}

// 1 行の入力欄では Enter で入力を終え、離れたときの保存に任せる
// IME の変換を確定する Enter では離れない
export function blurOnEnter(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).blur()
}

export function InlineInput({
  class: extra = "",
  onKeyDown = blurOnEnter,
  ...props
}: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class"> & { class?: string }) {
  return <input {...props} onKeyDown={onKeyDown} class={inlineFieldClass(extra)} />
}
