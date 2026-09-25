import type { ComponentChildren } from "preact"
import { ChevronIcon } from "../../components/icons"

// issue 画面の入力欄の部品。題名や説明の伸びる textarea と、属性欄の行・select・入力の見た目をまとめる

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

// 中身に合わせて高さを伸ばす textarea。題名は改行を入れず 1 行の文として扱う
export function AutoGrowTextarea({
  singleLine = false,
  onInput,
  ...props
}: {
  singleLine?: boolean
  onInput: (event: Event) => void
  [attribute: string]: unknown
}) {
  const resize = (element: HTMLTextAreaElement) => {
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }
  return (
    <textarea
      {...props}
      rows={1}
      ref={(element: HTMLTextAreaElement | null) => {
        if (element) requestAnimationFrame(() => resize(element))
      }}
      onInput={(event: Event) => {
        const element = event.currentTarget as HTMLTextAreaElement
        if (singleLine && element.value.includes("\n"))
          element.value = element.value.replace(/\n/g, " ")
        resize(element)
        onInput(event)
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (
          singleLine &&
          event.key === "Enter" &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.isComposing
        ) {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).blur()
        }
        const handler = props.onKeyDown as ((event: KeyboardEvent) => void) | undefined
        handler?.(event)
      }}
    />
  )
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

// 担当者がいないときに、アバターの場所を点線の丸で示す
export function EmptyAvatar() {
  return (
    <span class="grid size-[18px] shrink-0 place-items-center rounded-full border border-dashed border-hairline-strong" />
  )
}
