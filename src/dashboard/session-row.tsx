import { IssueId } from "../components/issue-id"
import { MetaRow } from "../components/meta-row"
import { FOCUS_RING } from "../components/focus-ring"
import { RelativeTime } from "../components/relative-time"
import { usd } from "../format"
import type { SessionSummary } from "../sessions"
import type { SessionTouches } from "./session-touches"

// dashboard のセッションの一覧の 1 行。題名と費用を上に、最後に動いた時刻・worktree・失敗の数などを下に小さく並べる
// 題名の無いセッションは、見分けがつくよう id の先頭 8 文字で示す
// そのセッションが聞いた質問と作った issue (touches) があれば、番号のリンクを最後の行に並べる

// 1 行に並べるリンクの数。多いセッションで行が縦に伸びすぎないよう、先頭だけを出して残りは数で示す
const TOUCH_LIMIT = 6

export function SessionRow({
  session,
  now,
  touches,
}: {
  session: SessionSummary
  now: Date
  touches?: SessionTouches
}) {
  const links = touches
    ? [
        ...touches.questions.map((question) => ({
          key: `q${question.id}`,
          href: question.href,
          title: question.title,
          label: <span class="font-mono">Q{question.id}</span>,
        })),
        ...touches.issues.map((issue) => ({
          key: `i${issue.id}`,
          href: issue.href,
          title: issue.title,
          label: <IssueId id={issue.id} />,
        })),
      ]
    : []
  return (
    <li class="flex flex-col gap-0.5 px-3 py-2.5">
      <div class="flex items-baseline gap-2">
        <span class="min-w-0 flex-1 truncate text-[13px] text-ink">
          {session.title ?? session.id.slice(0, 8)}
        </span>
        <span class="shrink-0 font-mono text-[12px] text-ink-muted tabular-nums">
          {usd(session.costUsd)}
        </span>
      </div>
      <MetaRow>
        <RelativeTime at={session.lastActivityAt ?? ""} now={now} />
        {session.worktree ? (
          <span class="font-mono text-ink-subtle">{session.worktree}</span>
        ) : null}
        <span>
          errors {session.toolErrors} / {session.toolResults}
        </span>
        {session.interruptions > 0 ? <span>interrupted {session.interruptions}</span> : null}
        {session.subagents > 0 ? <span>{session.subagents} subagents</span> : null}
        <span class="truncate">{session.models.join(", ")}</span>
      </MetaRow>
      {links.length > 0 ? (
        <MetaRow class="mt-0.5">
          {links.slice(0, TOUCH_LIMIT).map((link) => (
            <a
              key={link.key}
              href={link.href}
              title={link.title}
              class={`rounded-xs text-ink-subtle no-underline hover:text-ink ${FOCUS_RING}`}
            >
              {link.label}
            </a>
          ))}
          {links.length > TOUCH_LIMIT ? <span>+{links.length - TOUCH_LIMIT} more</span> : null}
        </MetaRow>
      ) : null}
    </li>
  )
}
