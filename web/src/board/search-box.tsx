import { useEffect, useRef, useState } from "preact/hooks"
import { IconButton } from "../components/icon-button"
import { CrossIcon } from "../components/icons/cross-icon"
import { SearchIcon } from "../components/icons/search-icon"
import { Kbd } from "../components/kbd"
import { DEFAULT_ISSUE_DISPLAY } from "./display"
import { pageHref, type PageFilters } from "./view-model"

// 見出しの検索欄。打つたびに少し待ってから onSearch を呼び、URL の検索語を置き換える
// スクリプトが動く前でも送れるように、いまの絞り込みと見せ方を隠し欄に持つ GET の form として描く
// 見せ方は pageHref と同じく既定と違うものだけを載せ、送った URL に既定の値が並ばないようにする
// スマホ幅では帯に欄を置く幅が無いので虫眼鏡のボタンだけを置き、押すと帯いっぱいに欄を広げる (data-expanded)。Esc か × で畳む
// 帯いっぱいに広げるため、置く側 (header.tsx) の枠は relative にしておく
// 欄の字はスマホ幅で 16px にする。iOS の Safari は 16px より小さい欄に focus すると画面を拡大してしまうため

export function SearchBox({
  filters,
  onSearch,
}: {
  filters: PageFilters
  onSearch: (query: string) => void
}) {
  const [query, setQuery] = useState(filters.query ?? "")
  const [expanded, setExpanded] = useState(false)
  const changed = useRef(false)
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setQuery(filters.query ?? "")
    changed.current = false
  }, [filters.query])

  useEffect(() => {
    if (!changed.current || query === (filters.query ?? "")) return
    const timer = setTimeout(() => onSearch(query), 120)
    return () => clearTimeout(timer)
  }, [filters.query, onSearch, query])

  useEffect(() => {
    if (expanded) input.current?.focus()
  }, [expanded])

  return (
    <>
      <IconButton
        id="search-open"
        label="Search"
        aria-controls="q"
        aria-expanded={expanded ? "true" : "false"}
        onClick={() => setExpanded(true)}
        class="sm:hidden"
      >
        <SearchIcon />
      </IconButton>
      <form
        method="get"
        role="search"
        action={pageHref({ basePath: filters.basePath })}
        data-expanded={expanded ? "" : undefined}
        class="relative hidden data-[expanded]:absolute data-[expanded]:inset-0 data-[expanded]:z-20 data-[expanded]:flex data-[expanded]:items-center data-[expanded]:gap-2 data-[expanded]:bg-canvas data-[expanded]:px-4 sm:block sm:data-[expanded]:static sm:data-[expanded]:block sm:data-[expanded]:bg-transparent sm:data-[expanded]:px-0"
        onSubmit={(event: Event) => {
          event.preventDefault()
          onSearch(query)
        }}
      >
        {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
        {filters.assignee ? <input type="hidden" name="assignee" value={filters.assignee} /> : null}
        {filters.label ? <input type="hidden" name="label" value={filters.label} /> : null}
        {filters.awaiting ? <input type="hidden" name="awaiting" value="1" /> : null}
        {filters.sort && filters.sort !== DEFAULT_ISSUE_DISPLAY.sort ? (
          <input type="hidden" name="sort" value={filters.sort} />
        ) : null}
        {filters.group && filters.group !== DEFAULT_ISSUE_DISPLAY.group ? (
          <input type="hidden" name="group" value={filters.group} />
        ) : null}
        {filters.completed && filters.completed !== DEFAULT_ISSUE_DISPLAY.completed ? (
          <input type="hidden" name="completed" value={filters.completed} />
        ) : null}
        {filters.view === "board" ? <input type="hidden" name="view" value="board" /> : null}
        <span class="relative block min-w-0 flex-1">
          <SearchIcon />
          <input
            ref={input}
            id="q"
            type="search"
            name="query"
            aria-label="Search issues"
            value={query}
            onInput={(event: InputEvent) => {
              const target = event.currentTarget as HTMLInputElement
              changed.current = true
              setQuery(target.value)
            }}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "Escape" || !expanded) return
              event.preventDefault()
              event.stopPropagation()
              setExpanded(false)
            }}
            placeholder="Search"
            autocomplete="off"
            class="peer h-9 w-full rounded-md border border-hairline bg-transparent pr-7 pl-7 font-sans text-base text-ink transition-colors placeholder:text-ink-tertiary hover:border-hairline-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-hover sm:h-7 sm:w-44 sm:text-body lg:w-56"
          />
          <span class="pointer-events-none absolute top-1/2 right-1.5 hidden -translate-y-1/2 sm:peer-placeholder-shown:block">
            <Kbd>/</Kbd>
          </span>
        </span>
        {expanded ? (
          <IconButton label="Close search" onClick={() => setExpanded(false)} class="sm:hidden">
            <CrossIcon />
          </IconButton>
        ) : null}
      </form>
    </>
  )
}
