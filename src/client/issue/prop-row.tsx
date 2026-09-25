import type { ComponentChildren } from "preact"

// issue 画面の属性欄の 1 行。左に項目名、右に値の入力を置き、値の前にアイコンを添えられる
// label 要素で包み、項目名を押しても値の入力に focus が移るようにする

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
