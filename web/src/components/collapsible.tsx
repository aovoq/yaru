import type { ComponentChildren } from "preact"
import { ChevronRightIcon } from "./icons/chevron-right-icon"

// 見出しの行 (summary) だけを見せ、押すと中身を開く枠。答えた質問を 1 行にたたむところなどで使う
// 開閉はブラウザの details と summary に任せる。dashboard はスクリプト無しで描くので、スクリプトに頼らず開閉でき、
// キーボード (Enter・Space) と読み上げ (開いているか閉じているか) にもそのまま対応するため
// https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element
// 見出しの左の矢じりは、開くと下を向く。ブラウザの既定の三角は list-none で消す
// Safari は list-none では消えず ::-webkit-details-marker を隠す必要がある。Tailwind の [&::…] は & が HTML で &amp; になり
// css.tsx の見本から拾えないので、その規則は css.tsx の base に置く

export function Collapsible({
  summary,
  open = false,
  class: extra = "",
  summaryClass = "",
  children,
}: {
  summary: ComponentChildren
  open?: boolean
  class?: string
  summaryClass?: string
  children?: ComponentChildren
}) {
  return (
    <details open={open} class={["group", extra].filter(Boolean).join(" ")}>
      <summary
        class={[
          "flex cursor-pointer list-none items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-hover",
          summaryClass,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span class="grid w-3 shrink-0 place-items-center transition-transform group-open:rotate-90">
          <ChevronRightIcon />
        </span>
        {summary}
      </summary>
      {children}
    </details>
  )
}
