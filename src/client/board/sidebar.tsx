import { STATUSES, type Issue } from "../../store"
import { Avatar } from "../../components/avatar"
import { GroupLabel } from "../../components/group-label"
import { IconButton } from "../../components/icon-button"
import { AllIcon } from "../../components/icons/all-icon"
import { QuestionIcon } from "../../components/icons/question-icon"
import { SidebarIcon } from "../../components/icons/sidebar-icon"
import { StatusIcon } from "../../components/icons/status-icon"
import { Kbd } from "../../components/kbd"
import { LabelDot } from "../../components/label-dot"
import { LogoLink } from "../../components/logo-link"
import type { SidebarPreference } from "../use-sidebar-preference"
import { pageHref, statusLabel, type PageFilters } from "../view-model"
import { NavItem } from "./nav-item"

// デスクトップ幅の左の絞り込み。全件・ダッシュボード・状態・ラベル・担当者ごとの件数を並べる
// 畳む・幅を変える操作は useSidebarPreference が受け持ち、ここは見た目と呼び出しだけを持つ

export function Sidebar({
  all,
  filters,
  sidebar,
  awaitingQuestionCount,
}: {
  all: Issue[]
  filters: PageFilters
  sidebar: SidebarPreference
  awaitingQuestionCount: number
}) {
  const labels = distinct(all.flatMap((issue) => issue.labels))
  const people = distinct(all.map((issue) => issue.assignee ?? ""))
  return (
    <nav
      id="sidebar"
      class="relative hidden min-w-0 shrink-0 flex-col overflow-hidden border-r border-hairline md:flex"
    >
      <div class="flex h-12 shrink-0 items-center gap-2 px-3">
        <LogoLink />
        <span class="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight text-ink">
          yaru
        </span>
        <IconButton
          id="sidebar-toggle"
          label="Collapse sidebar"
          aria-controls="sidebar"
          onClick={sidebar.closeSidebar}
        >
          <SidebarIcon />
        </IconButton>
      </div>
      <div class="flex-1 overflow-y-auto px-2 pb-4">
        <NavItem
          href={pageHref({ ...filters, status: undefined })}
          active={!filters.status}
          icon={<AllIcon />}
          label="All issues"
          count={all.length}
        />
        <NavItem
          href={`${filters.basePath ?? ""}/dashboard`}
          active={false}
          icon={<QuestionIcon />}
          label="Dashboard"
          count={awaitingQuestionCount}
        />
        <GroupLabel class="mt-4 mb-1">Status</GroupLabel>
        {STATUSES.map((status) => (
          <NavItem
            href={pageHref({ ...filters, status: filters.status === status ? undefined : status })}
            active={filters.status === status}
            icon={<StatusIcon status={status} />}
            label={statusLabel(status)}
            count={all.filter((issue) => issue.status === status).length}
          />
        ))}
        {labels.length > 0 ? (
          <>
            <GroupLabel class="mt-4 mb-1">Labels</GroupLabel>
            {labels.map((label) => (
              <NavItem
                href={pageHref({ ...filters, label: filters.label === label ? undefined : label })}
                active={filters.label === label}
                icon={<LabelDot label={label} />}
                label={label}
                count={all.filter((issue) => issue.labels.includes(label)).length}
              />
            ))}
          </>
        ) : null}
        {people.length > 0 ? (
          <>
            <GroupLabel class="mt-4 mb-1">People</GroupLabel>
            {people.map((person) => (
              <NavItem
                href={pageHref({
                  ...filters,
                  assignee: filters.assignee === person ? undefined : person,
                })}
                active={filters.assignee === person}
                icon={<Avatar name={person} />}
                label={person}
                count={all.filter((issue) => issue.assignee === person).length}
              />
            ))}
          </>
        ) : null}
      </div>
      <div class="shrink-0 truncate border-t border-hairline px-3 py-3 text-[11px] text-ink-tertiary">
        <Kbd>C</Kbd> new · <Kbd>/</Kbd> search · <Kbd>J K</Kbd> move
      </div>
      <div
        id="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={sidebar.startResize}
        class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none hover:bg-primary"
      />
    </nav>
  )
}

// 空の値を除き、重ならないように名前順で並べる
function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((first, second) => first.localeCompare(second))
}
