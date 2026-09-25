import type { ComponentChildren } from "preact"

// 見出しつきのまとまり。件数 (count)、題名に続けて折り返して並べる札 (meta)、右端の補足 (aside) を見出しの行に置ける

export function Section({
  title,
  count,
  meta,
  aside,
  children,
}: {
  title: string
  count?: number
  meta?: ComponentChildren
  aside?: ComponentChildren
  children?: ComponentChildren
}) {
  return (
    <section class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <h2 class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-ink">
          {title}
          {count !== undefined ? (
            <span class="font-normal text-ink-tertiary tabular-nums">{count}</span>
          ) : null}
          {meta}
        </h2>
        {aside ? <div class="ml-auto">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}
