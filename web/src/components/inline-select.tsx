import type { ComponentChildren } from "preact"
import { ChevronIcon } from "./icons/chevron-icon"
import { inlineFieldClass } from "./inline-input"

// InlineInput と同じ見た目の select。issue 画面の属性欄の状態と優先度で使う
// ブラウザの矢印は消し、同じ色の ChevronIcon を右端に重ねる
// 選んだ値は change で受ける。select は 1 回の変更で input と change の両方を出すので、片方だけにする

export function InlineSelect({
  name,
  value,
  onChange,
  class: extra = "",
  children,
}: {
  name: string
  value: string
  onChange: (event: Event) => void
  class?: string
  children?: ComponentChildren
}) {
  return (
    <div class={["relative w-full min-w-0", extra].filter(Boolean).join(" ")}>
      <select
        name={name}
        value={value}
        onChange={onChange}
        class={inlineFieldClass("appearance-none pr-7")}
      >
        {children}
      </select>
      <span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-tertiary">
        <ChevronIcon />
      </span>
    </div>
  )
}
