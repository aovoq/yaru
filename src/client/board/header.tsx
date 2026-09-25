import type { ComponentChildren } from "preact"
import { buttonClass } from "../../components/button"
import { BoardIcon } from "../../components/icons/board-icon"
import { CrossIcon } from "../../components/icons/cross-icon"
import { ListIcon } from "../../components/icons/list-icon"
import { LogoLink } from "../../components/logo-link"
import { PlusIcon } from "../../components/icons/plus-icon"
import { SidebarIcon } from "../../components/icons/sidebar-icon"
import { Avatar } from "../../components/avatar"
import { LabelDot } from "../../components/label-dot"
import { newIssueHref, pageHref, statusLabel, type PageFilters } from "../view-model"
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
    <header class="flex h-12 shrink-0 items-center gap-3 border-b border-hairline px-4">
      <LogoLink class="md:hidden" />
      {/* 畳んだ左の絞り込みを開き直す。表示は css.tsx の html[data-sidebar="closed"] #sidebar-open が切り替えるので、hidden と衝突する表示クラスを持つ Button は使わない */}
      <button
        id="sidebar-open"
        type="button"
        title="Open sidebar"
        aria-label="Open sidebar"
        aria-controls="sidebar"
        aria-expanded="false"
        onClick={onOpenSidebar}
        class="hidden size-7 shrink-0 place-items-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
      >
        <SidebarIcon />
      </button>
      <h1 class="hidden shrink-0 items-center gap-2 text-[13px] font-medium text-ink sm:flex">
        {filters.status ? statusLabel(filters.status) : "All issues"}
        <span class="font-normal text-ink-tertiary tabular-nums">{count}</span>
      </h1>
      <FilterChips filters={filters} />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <SearchBox filters={filters} onSearch={onSearch} />
        <ViewToggle filters={filters} list={list} />
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
    </header>
  )
}

// ラベルと担当者の絞り込みを、押すと外れる札として並べる。状態と検索語は別の場所で見せるので含めない
function FilterChips({ filters }: { filters: PageFilters }) {
  const chips: { icon: ComponentChildren; text: string; href: string }[] = []
  if (filters.label)
    chips.push({
      icon: <LabelDot label={filters.label} />,
      text: filters.label,
      href: pageHref({ ...filters, label: undefined }),
    })
  if (filters.assignee)
    chips.push({
      icon: <Avatar name={filters.assignee} />,
      text: filters.assignee,
      href: pageHref({ ...filters, assignee: undefined }),
    })
  if (chips.length === 0) return null
  return (
    <div class="hidden min-w-0 items-center gap-1.5 overflow-hidden lg:flex">
      {chips.map((chip) => (
        <a
          href={chip.href}
          class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-surface-1 pr-1.5 pl-2 text-xs text-ink-muted no-underline transition-colors hover:border-hairline-strong focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
        >
          {chip.icon}
          {chip.text}
          <CrossIcon />
        </a>
      ))}
    </div>
  )
}

function ViewToggle({ filters, list }: { filters: PageFilters; list: boolean }) {
  const tab = (active: boolean) =>
    `grid h-6 w-7 place-items-center rounded-[5px] no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50 ${
      active ? "bg-surface-3 text-ink" : "text-ink-tertiary hover:text-ink"
    }`
  return (
    <div class="flex shrink-0 items-center gap-0.5 rounded-md border border-hairline p-0.5">
      <a href={pageHref({ ...filters, view: "board" })} class={tab(!list)} title="Board">
        <BoardIcon />
      </a>
      <a href={pageHref({ ...filters, view: "list" })} class={tab(list)} title="List">
        <ListIcon />
      </a>
    </div>
  )
}
