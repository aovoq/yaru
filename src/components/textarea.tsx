import type { JSX } from "preact"

// 複数行の入力欄の見た目。issue 画面のコメント欄、説明の Markdown の編集 (mono)、質問の回答欄で使う
// 置く場所ごとに見た目を変えず 1 つにそろえる。カード (surface-1) の中でも枠線 (hairline) で欄の形が分かる
// focus したら枠を primary にする。primary は地 (canvas から surface-4) に対して 3.7:1 以上あり、
// WCAG 2.2 の "at least 3:1 against adjacent colors" を満たす https://www.w3.org/TR/WCAG22/#non-text-contrast
// sm の幅より狭い画面では 16px にする。iOS の Safari は 16px 未満の欄に focus すると画面を拡大してしまうため
// 高さの下限と伸ばし方 (resize) は置く場所ごとに違うので extra で渡す

export function textareaClass({ mono = false }: { mono?: boolean } = {}, extra = ""): string {
  return [
    "w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 text-base text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none sm:text-body",
    mono ? "font-mono sm:leading-relaxed" : "font-sans",
    extra,
  ]
    .filter(Boolean)
    .join(" ")
}

export function Textarea({
  mono = false,
  class: extra = "resize-y",
  ...props
}: Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "class"> & {
  mono?: boolean
  class?: string
}) {
  return <textarea {...props} class={textareaClass({ mono }, extra)} />
}
