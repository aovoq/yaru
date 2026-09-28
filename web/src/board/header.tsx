import { buttonClass } from "../components/button"
import { Chip } from "../components/chip"
import { HeaderBar } from "../components/header-bar"
import { HIT_AREA } from "../components/hit-area"
import { IconButton } from "../components/icon-button"
import { BoardIcon } from "../components/icons/board-icon"
import { ListIcon } from "../components/icons/list-icon"
import { PlusIcon } from "../components/icons/plus-icon"
import { QuestionIcon } from "../components/icons/question-icon"
import { SidebarIcon } from "../components/icons/sidebar-icon"
import { LogoLink } from "../components/logo-link"
import { SegmentedControl } from "../components/segmented-control"
import { newIssueHref, pageHref, statusLabel, type PageFilters } from "./view-model"
import { CommandPaletteButton } from "./command-palette-button"
import { DisplayMenu } from "./display-menu"
import { FilterChips } from "./filter-chips"
import { SearchBox } from "./search-box"

// 板の上端の帯。いまの絞り込みの名前と件数、外せる絞り込み、検索、見せ方 (Display)、板と一覧の切り替え、新規作成を並べる
// スマホ幅ではサイドバーが無いので、ダッシュボードへの入口を答えを待っている質問の数と一緒にここへ置く
// ⌘K のコマンドパレットの入口も置く。キーボードの無いスマホでは、ここからしか開けないため
// サイドバーを出す md から lg の間は本体の幅が狭いので、Display と New issue は字を短くし、帯からはみ出さないようにする
// ホーム画面から開いたときに切り欠きの下へ潜らないよう、帯の外側に安全な余白 (pt-safe) を取る。帯そのものの高さは変えない

export function Header({
  filters,
  count,
  awaitingQuestionCount,
  labelColors,
  onSearch,
  onOpenSidebar,
}: {
  filters: PageFilters
  count: number
  awaitingQuestionCount: number
  labelColors: Map<string, string>
  onSearch: (query: string) => void
  onOpenSidebar: () => void
}) {
  const list = filters.view === "list"
  return (
    <div class="pt-safe shrink-0">
      <HeaderBar gap={3} class="relative">
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
        <h1 class="text-body hidden shrink-0 items-center gap-2 font-medium text-ink sm:flex">
          {filters.status
            ? statusLabel(filters.status)
            : filters.awaiting
              ? "Awaiting answer"
              : "All issues"}
          <span class="font-normal text-ink-tertiary tabular-nums">{count}</span>
        </h1>
        <FilterChips
          filters={filters}
          labelColors={labelColors}
          class="hidden overflow-hidden md:flex"
        />
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <CommandPaletteButton />
          <SearchBox filters={filters} onSearch={onSearch} />
          <Chip
            id="mobile-dashboard-link"
            href={`${filters.basePath ?? ""}/dashboard`}
            icon={<QuestionIcon />}
            class={`md:hidden ${HIT_AREA}`}
          >
            <span class="sr-only">Dashboard, </span>
            <span class={`tabular-nums ${awaitingQuestionCount > 0 ? "text-primary-hover" : ""}`}>
              {awaitingQuestionCount}
            </span>
            <span class="sr-only"> awaiting answer</span>
          </Chip>
          <DisplayMenu filters={filters} />
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
            <span class="hidden lg:inline">New issue</span>
            <span class="lg:hidden">New</span>
          </a>
        </div>
      </HeaderBar>
    </div>
  )
}
