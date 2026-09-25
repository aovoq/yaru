import { useEffect, useRef, useState } from "preact/hooks"
import { SearchIcon } from "../../components/icons"
import { Kbd } from "../../components/issue-metadata"
import { pageHref, type PageFilters } from "../view-model"

// 見出しの検索欄。打つたびに少し待ってから onSearch を呼び、URL の検索語を置き換える
// スクリプトが動く前でも送れるように、いまの絞り込みを隠し欄に持つ GET の form として描く

export function SearchBox({
  filters,
  onSearch,
}: {
  filters: PageFilters
  onSearch: (query: string) => void
}) {
  const [query, setQuery] = useState(filters.query ?? "")
  const changed = useRef(false)

  useEffect(() => {
    setQuery(filters.query ?? "")
    changed.current = false
  }, [filters.query])

  useEffect(() => {
    if (!changed.current || query === (filters.query ?? "")) return
    const timer = setTimeout(() => onSearch(query), 120)
    return () => clearTimeout(timer)
  }, [filters.query, onSearch, query])

  return (
    <form
      method="get"
      action={pageHref({ basePath: filters.basePath })}
      class="relative hidden sm:block"
      onSubmit={(event: Event) => {
        event.preventDefault()
        onSearch(query)
      }}
    >
      {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
      {filters.assignee ? <input type="hidden" name="assignee" value={filters.assignee} /> : null}
      {filters.label ? <input type="hidden" name="label" value={filters.label} /> : null}
      {filters.view === "board" ? <input type="hidden" name="view" value="board" /> : null}
      <SearchIcon />
      <input
        id="q"
        type="search"
        name="query"
        value={query}
        onInput={(event: InputEvent) => {
          const input = event.currentTarget as HTMLInputElement
          changed.current = true
          setQuery(input.value)
        }}
        placeholder="Search"
        autocomplete="off"
        class="peer h-7 w-44 rounded-md border border-hairline bg-transparent pr-7 pl-7 font-sans text-[13px] text-ink transition-colors placeholder:text-ink-tertiary hover:border-hairline-strong focus-visible:border-hairline-strong focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50 lg:w-56"
      />
      <span class="pointer-events-none absolute top-1/2 right-1.5 hidden -translate-y-1/2 peer-placeholder-shown:block">
        <Kbd>/</Kbd>
      </span>
    </form>
  )
}
