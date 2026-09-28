import { buttonClass } from "../components/button"
import { Avatar } from "../components/avatar"
import { GroupLabel } from "../components/group-label"
import { IconButton } from "../components/icon-button"
import { AllIcon } from "../components/icons/all-icon"
import { ChevronIcon } from "../components/icons/chevron-icon"
import { ClockIcon } from "../components/icons/clock-icon"
import { QuestionIcon } from "../components/icons/question-icon"
import { SidebarIcon } from "../components/icons/sidebar-icon"
import { StatusIcon } from "../components/icons/status-icon"
import { Kbd } from "../components/kbd"
import { LabelDot } from "../components/label-dot"
import { LogoLink } from "../components/logo-link"
import { labelColors } from "../components/tint"
import { STATUSES, type Issue } from "../domain/issue"
import type { Question } from "../domain/question"
import { boardHref, statusLabel, workspaceName } from "./board-link"
import { NavItem } from "./nav-item"
import { setSidebarOpen, startSidebarResize } from "./sidebar-gesture"
import { summarizeAwaiting } from "./summarize-awaiting"

// dashboard の左の絞り込み。板と同じサイドバー。src/client/board/sidebar.tsx
// ワークスペースの切り替えは、この画面では一覧 (/) へ移る。src/ui/live-page.ts:263-265

export function Sidebar({
  issues,
  questions,
  basePath,
}: {
  issues: Issue[]
  questions: Question[]
  basePath: string
}) {
  const awaitingByIssue = summarizeAwaiting(questions)
  const colors = labelColors(issues.flatMap((issue) => issue.labels))
  const labels = distinct(issues.flatMap((issue) => issue.labels))
  const people = distinct(issues.map((issue) => issue.assignee ?? ""))
  const awaitingIssueCount = issues.filter(
    (issue) => awaitingByIssue[issue.id] !== undefined,
  ).length
  const awaitingQuestionCount = questions.filter(
    (question) => question.status === "open" || question.status === "expired",
  ).length
  return (
    <nav
      id="sidebar"
      class="pt-safe relative hidden min-w-0 shrink-0 flex-col border-r border-hairline md:flex"
    >
      <div class="flex h-12 shrink-0 items-center gap-1.5 px-3">
        <LogoLink />
        <WorkspaceSwitcher basePath={basePath} />
        <IconButton
          id="sidebar-toggle"
          label="Collapse sidebar"
          aria-controls="sidebar"
          onClick={() => setSidebarOpen(false)}
        >
          <SidebarIcon />
        </IconButton>
      </div>
      <div class="flex-1 overflow-y-auto px-2 pb-4">
        <NavItem
          href={boardHref(basePath)}
          active={false}
          icon={<AllIcon />}
          label="All issues"
          count={issues.length}
        />
        <NavItem
          href={boardHref(basePath, { awaiting: true })}
          active={false}
          icon={<ClockIcon />}
          label="Awaiting answer"
          count={awaitingIssueCount}
        />
        <NavItem
          href={`${basePath}/dashboard`}
          active
          icon={<QuestionIcon />}
          label="Dashboard"
          count={awaitingQuestionCount}
        />
        <GroupLabel class="mt-4 mb-1 px-2">Status</GroupLabel>
        {STATUSES.map((status) => (
          <NavItem
            key={status}
            href={boardHref(basePath, { status })}
            active={false}
            icon={<StatusIcon status={status} decorative />}
            label={statusLabel(status)}
            count={issues.filter((issue) => issue.status === status).length}
          />
        ))}
        {labels.length > 0 ? (
          <>
            <GroupLabel class="mt-4 mb-1 px-2">Labels</GroupLabel>
            {labels.map((label) => (
              <NavItem
                key={label}
                href={boardHref(basePath, { label })}
                active={false}
                icon={<LabelDot label={label} color={colors.get(label)} />}
                label={label}
                count={issues.filter((issue) => issue.labels.includes(label)).length}
              />
            ))}
          </>
        ) : null}
        {people.length > 0 ? (
          <>
            <GroupLabel class="mt-4 mb-1 px-2">People</GroupLabel>
            {people.map((person) => (
              <NavItem
                key={person}
                href={boardHref(basePath, { assignee: person })}
                active={false}
                icon={<Avatar name={person} />}
                label={person}
                count={issues.filter((issue) => issue.assignee === person).length}
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
        onPointerDown={startSidebarResize}
        class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none hover:bg-primary"
      />
    </nav>
  )
}

function WorkspaceSwitcher({ basePath }: { basePath: string }) {
  const name = workspaceName(basePath)
  if (!basePath) {
    return <span class="text-body min-w-0 flex-1 truncate font-medium text-ink">{name}</span>
  }
  return (
    <span class="min-w-0 flex-1">
      <button
        id="workspace-switcher"
        type="button"
        onClick={() => {
          window.location.assign("/")
        }}
        class={buttonClass(
          "ghost",
          "sm",
          "max-w-[calc(var(--sidebar-width,14rem)-5.5rem)] min-w-0",
          { align: "start" },
        )}
      >
        <span class="truncate">{name}</span>
        <ChevronIcon />
      </button>
    </span>
  )
}

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((first, second) => first.localeCompare(second))
}
