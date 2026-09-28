import type { AwaitingSummary } from "./page-data"
import { STATUSES, type Issue } from "../domain/issue"
import { Avatar } from "../components/avatar"
import { GroupLabel } from "../components/group-label"
import { IconButton } from "../components/icon-button"
import { AllIcon } from "../components/icons/all-icon"
import { ClockIcon } from "../components/icons/clock-icon"
import { QuestionIcon } from "../components/icons/question-icon"
import { SidebarIcon } from "../components/icons/sidebar-icon"
import { StatusIcon } from "../components/icons/status-icon"
import { Kbd } from "../components/kbd"
import { LabelDot } from "../components/label-dot"
import { LogoLink } from "../components/logo-link"
import type { SidebarPreference } from "../app/use-sidebar-preference"
import { pageHref, statusLabel, type PageFilters } from "./view-model"
import { TerminalIcon } from "../components/icons/terminal-icon"
import { NavItem } from "./nav-item"
import { WorkspaceSwitcher } from "./workspace-switcher"

// デスクトップ幅の左の絞り込み。ワークスペースの名前と切り替え、全件・答え待ち・ダッシュボード・状態・ラベル・担当者ごとの件数を並べる
// 畳む・幅を変える操作は useSidebarPreference が受け持ち、ここは見た目と呼び出しだけを持つ
// dashboard もサーバーで同じサイドバーを描くので、props だけで描けるようにする。sidebar を渡さないと畳む・幅を変える操作は何もしない
// ワークスペースの切り替えの面はサイドバーの幅より広く、右の本体へはみ出して開くので、nav では overflow を切らない
// 名前が長いときは各行の truncate で切り詰める
// active はいまの画面。dashboard で描くときは "dashboard" を渡し、板の絞り込みではなく Dashboard を選んだ印にする

export function Sidebar({
  all,
  filters,
  sidebar,
  awaitingQuestionCount,
  awaitingByIssue,
  labelColors,
  active = "issues",
}: {
  all: Issue[]
  filters: PageFilters
  sidebar?: SidebarPreference
  awaitingQuestionCount: number
  awaitingByIssue: Record<string, AwaitingSummary>
  labelColors: Map<string, string>
  active?: "issues" | "dashboard"
}) {
  const onIssues = active === "issues"
  const labels = distinct(all.flatMap((issue) => issue.labels))
  const people = distinct(all.map((issue) => issue.assignee ?? ""))
  const awaitingIssueCount = all.filter((issue) => awaitingByIssue[issue.id] !== undefined).length
  return (
    <nav
      id="sidebar"
      class="pt-safe relative hidden min-w-0 shrink-0 flex-col border-r border-hairline md:flex"
    >
      <div class="flex h-12 shrink-0 items-center gap-1.5 px-3">
        <LogoLink />
        <WorkspaceSwitcher basePath={filters.basePath ?? ""} />
        <IconButton
          id="sidebar-toggle"
          label="Collapse sidebar"
          aria-controls="sidebar"
          onClick={sidebar?.closeSidebar}
        >
          <SidebarIcon />
        </IconButton>
      </div>
      <div class="flex-1 overflow-y-auto px-2 pb-4">
        <NavItem
          href={pageHref({ ...filters, status: undefined, awaiting: undefined })}
          active={onIssues && !filters.status && !filters.awaiting}
          icon={<AllIcon />}
          label="All issues"
          count={all.length}
        />
        <NavItem
          href={pageHref({ ...filters, status: undefined, awaiting: !filters.awaiting })}
          active={onIssues && Boolean(filters.awaiting)}
          icon={<ClockIcon />}
          label="Awaiting answer"
          count={awaitingIssueCount}
        />
        <NavItem
          href={`${filters.basePath ?? ""}/dashboard`}
          active={active === "dashboard"}
          icon={<QuestionIcon />}
          label="Dashboard"
          count={awaitingQuestionCount}
        />
        <NavItem href="/terminal" active={false} icon={<TerminalIcon />} label="Terminal" />
        <GroupLabel class="mt-4 mb-1 px-2">Status</GroupLabel>
        {STATUSES.map((status) => (
          <NavItem
            href={pageHref({ ...filters, status: filters.status === status ? undefined : status })}
            active={onIssues && filters.status === status}
            icon={<StatusIcon status={status} decorative />}
            label={statusLabel(status)}
            count={all.filter((issue) => issue.status === status).length}
          />
        ))}
        {labels.length > 0 ? (
          <>
            <GroupLabel class="mt-4 mb-1 px-2">Labels</GroupLabel>
            {labels.map((label) => (
              <NavItem
                href={pageHref({ ...filters, label: filters.label === label ? undefined : label })}
                active={onIssues && filters.label === label}
                icon={<LabelDot label={label} color={labelColors.get(label)} />}
                label={label}
                count={all.filter((issue) => issue.labels.includes(label)).length}
              />
            ))}
          </>
        ) : null}
        {people.length > 0 ? (
          <>
            <GroupLabel class="mt-4 mb-1 px-2">People</GroupLabel>
            {people.map((person) => (
              <NavItem
                href={pageHref({
                  ...filters,
                  assignee: filters.assignee === person ? undefined : person,
                })}
                active={onIssues && filters.assignee === person}
                icon={<Avatar name={person} />}
                label={person}
                count={all.filter((issue) => issue.assignee === person).length}
              />
            ))}
          </>
        ) : null}
      </div>
      <div class="text-micro shrink-0 truncate border-t border-hairline px-3 py-3 text-ink-tertiary">
        <Kbd>C</Kbd> new · <Kbd>/</Kbd> search · <Kbd>J</Kbd> <Kbd>K</Kbd> move
      </div>
      <div
        id="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={sidebar?.startResize}
        class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none hover:bg-primary"
      />
    </nav>
  )
}

// 空の値を除き、重ならないように名前順で並べる
function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((first, second) => first.localeCompare(second))
}
