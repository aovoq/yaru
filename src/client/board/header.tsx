import { buttonClass } from "../../components/button"
import { HeaderBar } from "../../components/header-bar"
import { IconButton } from "../../components/icon-button"
import { BoardIcon } from "../../components/icons/board-icon"
import { ListIcon } from "../../components/icons/list-icon"
import { PlusIcon } from "../../components/icons/plus-icon"
import { SidebarIcon } from "../../components/icons/sidebar-icon"
import { LogoLink } from "../../components/logo-link"
import { SegmentedControl } from "../../components/segmented-control"
import { newIssueHref, pageHref, statusLabel, type PageFilters } from "../view-model"
import { FilterChips } from "./filter-chips"
import { SearchBox } from "./search-box"

// 板の上端の帯。いまの絞り込みの名前と件数、外せる絞り込み、検索、板と一覧の切り替え、新規作成を並べる

export function Header({
  filters,
  count,
  onSearch,
  onOpenSidebar,
}: {
  filters: PageFilters
  count: number
  onSearch: (query: string) => void
  onOpenSidebar: () => void
}) {
  const list = filters.view === "list"
  return (
    <HeaderBar gap={3}>
      <LogoLink class="md:hidden" />
      {/* 畳んだ左の絞り込みを開き直す。最初は hidden で隠し、css.tsx の html[data-sidebar="closed"] #sidebar-open が grid にして見せる */}
      <IconButton
        id="sidebar-open"
        label="Open sidebar"
        aria-controls="sidebar"
        aria-expanded="false"
        onClick={onOpenSidebar}
        class="hidden"
      >
        <SidebarIcon />
      </IconButton>
      <h1 class="hidden shrink-0 items-center gap-2 text-[13px] font-medium text-ink sm:flex">
        {filters.status ? statusLabel(filters.status) : "All issues"}
        <span class="font-normal text-ink-tertiary tabular-nums">{count}</span>
      </h1>
      <FilterChips filters={filters} />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <SearchBox filters={filters} onSearch={onSearch} />
        <SegmentedControl
          items={[
            {
              href: pageHref({ ...filters, view: "board" }),
              title: "Board",
              icon: <BoardIcon />,
              active: !list,
            },
            {
              href: pageHref({ ...filters, view: "list" }),
              title: "List",
              icon: <ListIcon />,
              active: list,
            },
          ]}
        />
        <a
          id="new-issue"
          href={newIssueHref(filters, filters.status)}
          class={buttonClass("primary", "sm", "shrink-0 pr-2.5 pl-2")}
        >
          <PlusIcon />
          <span class="hidden sm:inline">New issue</span>
          <span class="sm:hidden">New</span>
        </a>
      </div>
    </HeaderBar>
  )
}
