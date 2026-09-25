import type { JSX } from "preact"

// 枠を見せずに値を並べておき、hover と focus で初めて面が出る入力欄。issue 画面の属性欄 (担当者・ラベル・期限・親・止めている issue) で使う
// select の InlineSelect も同じ見た目にそろえる
// focus したら枠を primary にし、どの欄を打っているかを示す (textarea.tsx と同じ理由)
// sm の幅より狭い画面では 16px にする。iOS の Safari は 16px 未満の欄に focus すると画面を拡大してしまうため

export function inlineFieldClass(extra = ""): string {
  return [
    "h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 font-sans text-base text-ink transition-colors placeholder:text-ink-tertiary hover:bg-surface-2 focus-visible:border-primary focus-visible:bg-surface-2 focus-visible:outline-none sm:text-body",
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

// onKeyDown を省くと Enter で入力を終える (blurOnEnter)。日付の欄のように Enter をブラウザに任せたいときは null を渡す
export function InlineInput({
  class: extra = "",
  onKeyDown = blurOnEnter,
  ...props
}: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class" | "onKeyDown"> & {
  class?: string
  onKeyDown?: ((event: KeyboardEvent) => void) | null
}) {
  return <input {...props} onKeyDown={onKeyDown ?? undefined} class={inlineFieldClass(extra)} />
}
