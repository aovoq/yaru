import type { JSX } from "preact"
import { renderMarkdown } from "../markdown"

// 本文の Markdown を描く。生の HTML と危ないリンクは renderMarkdown が止めるので、本文は必ずここを通す
// compact は質問やコメントのように小さく詰めて見せるとき
// issueHref を渡すと、本文の #<id> をその issue へのリンク (data-issue 付き) にする。板と issue 画面で同じ板の中を移るため
// 残りの属性 (id・onClick など) は包む div にそのまま渡す
// issue の説明のように、描いた本文そのものを押して編集に移る場所で使うため

export function Markdown({
  source,
  compact = false,
  issueHref,
  class: extra = "",
  ...props
}: Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "class" | "className" | "children" | "dangerouslySetInnerHTML"
> & {
  source: string
  compact?: boolean
  issueHref?: (id: string) => string
  class?: string
}) {
  return (
    <div
      {...props}
      class={["markdown", compact ? "markdown-compact" : "", extra].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source, { issueHref }) }}
    />
  )
}
