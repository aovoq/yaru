import { renderMarkdown } from "../markdown"

// 本文の Markdown を描く。生の HTML と危ないリンクは renderMarkdown が止めるので、本文は必ずここを通す
// compact は質問やコメントのように小さく詰めて見せるとき

export function Markdown({
  source,
  compact = false,
  class: extra = "",
}: {
  source: string
  compact?: boolean
  class?: string
}) {
  return (
    <div
      class={["markdown", compact ? "markdown-compact" : "", extra].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  )
}
