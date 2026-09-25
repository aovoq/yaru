import type { ComponentChildren, JSX } from "preact"
import { FOCUS_RING } from "./focus-ring"

// 文字だけのリンク。見出しの帯の「Issues」やワークスペース名、空の板の「Clear filters」、エラー画面の「back」で使う
// subtle は帯の中で目立たせずに置く移動先、primary は次にしてほしい操作へ誘うリンク

export type TextLinkTone = "subtle" | "primary"
export type TextLinkSize = "xs" | "sm"

const TONES: Record<TextLinkTone, string> = {
  subtle: "text-ink-subtle no-underline hover:text-ink",
  primary: "text-primary-hover no-underline hover:underline",
}

const SIZES: Record<TextLinkSize, string> = {
  xs: "text-xs",
  sm: "text-[13px]",
}

export function TextLink({
  href,
  tone = "subtle",
  size = "sm",
  class: extra = "",
  children,
  ...rest
}: {
  href: string
  tone?: TextLinkTone
  size?: TextLinkSize
  class?: string
  children?: ComponentChildren
} & Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "size" | "class" | "children">) {
  return (
    <a
      {...rest}
      href={href}
      class={[SIZES[size], TONES[tone], FOCUS_RING, extra].filter(Boolean).join(" ")}
    >
      {children}
    </a>
  )
}
