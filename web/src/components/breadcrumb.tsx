import { Fragment } from "preact"
import { FOCUS_RING } from "./focus-ring"
import { HIT_AREA } from "./hit-area"
import { ChevronRightIcon } from "./icons/chevron-right-icon"

// 見出しの帯に置く、いまの画面までの道筋 (Projects › AsukaTravel › Dashboard)。先の段ほど細かい
// 最後の段がいまの画面で、押せない字にして aria-current で読み上げにも伝える。それより前の段はその画面へのリンク
// 段の区切りは右向きの矢じり。字の「/」や「›」は読み上げで読まれてしまうので、飾りのアイコンにする
// 狭い画面で長いワークスペースの名前が並んでも帯からはみ出さないよう、各段は切り詰める
// https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/

export type BreadcrumbItem = { label: string; href?: string }

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" class="min-w-0">
      <ol class="flex min-w-0 items-center gap-1.5">
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <Fragment key={item.label}>
              {index > 0 ? (
                <li aria-hidden="true" class="shrink-0">
                  <ChevronRightIcon />
                </li>
              ) : null}
              <li class={`flex min-w-0 ${current ? "shrink-0" : ""}`}>
                {current || item.href === undefined ? (
                  <span
                    aria-current={current ? "page" : undefined}
                    class="text-body truncate font-medium text-ink"
                  >
                    {item.label}
                  </span>
                ) : (
                  <a
                    href={item.href}
                    class={`text-body min-w-0 rounded-xs text-ink-subtle no-underline hover:text-ink ${HIT_AREA} ${FOCUS_RING}`}
                  >
                    <span class="block truncate">{item.label}</span>
                  </a>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
