import type { JSX } from "preact"

// 複数行の入力欄の見た目。issue 画面のコメント欄、説明の Markdown の編集 (mono)、質問の回答欄 (canvas) で使う
// tone は置く面との差で決める。surface は画面の地の上に一段明るい面で置き、canvas はカード (surface-1) の中で一段沈めて置く
// 高さの下限と伸ばし方 (resize) は置く場所ごとに違うので extra で渡す

export type TextareaTone = "surface" | "canvas"

export function textareaClass(
  { mono = false, tone = "surface" }: { mono?: boolean; tone?: TextareaTone } = {},
  extra = "",
): string {
  const font = mono
    ? "font-mono text-[13px] leading-relaxed"
    : tone === "canvas"
      ? // スマホは 16px 未満の欄に focus すると画面を拡大してしまうので、狭い幅では大きめの字にする
        "font-sans text-[15px] sm:text-[13px]"
      : "font-sans text-[14px]"
  const surface =
    tone === "canvas"
      ? "rounded-md bg-canvas px-2.5 py-2 focus:border-primary"
      : `${mono ? "rounded-md" : "rounded-lg"} bg-surface-1 p-3 focus:border-hairline-strong`
  return [
    "w-full border border-hairline text-ink placeholder:text-ink-tertiary focus:outline-none",
    surface,
    font,
    extra,
  ]
    .filter(Boolean)
    .join(" ")
}

export function Textarea({
  mono = false,
  tone = "surface",
  class: extra = "resize-y",
  ...props
}: Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "class"> & {
  mono?: boolean
  tone?: TextareaTone
  class?: string
}) {
  return <textarea {...props} class={textareaClass({ mono, tone }, extra)} />
}
