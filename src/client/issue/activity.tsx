import { StatusIcon } from "../../components/icons/status-icon"
import { Avatar } from "../../components/avatar"
import { Markdown } from "../../components/markdown"
import { Section } from "../../components/section"
import type { Comment, Issue } from "../../store"
import { relativeTime } from "../../time"

// issue 画面の活動欄。状態が変わった出来事とコメントを 1 本の流れで見せる

type ActivityEntry =
  | { kind: "event"; at: string; order: number; text: string; status: string }
  | { kind: "comment"; at: string; order: number; comment: Comment }

// issue が作られた・始まった・終わった時刻とコメントを、時刻順の 1 本の流れにする
// 時刻が同じときは作成 → 開始 → 完了 → コメントの順に並べる
export function Activity({ issue, comments }: { issue: Issue; comments: Comment[] }) {
  const entries: ActivityEntry[] = []
  if (issue.createdAt) {
    entries.push({
      kind: "event",
      at: issue.createdAt,
      order: 0,
      text: "created the issue",
      status: "todo",
    })
  }
  if (issue.startedAt) {
    entries.push({
      kind: "event",
      at: issue.startedAt,
      order: 1,
      text: "started working",
      status: "in_progress",
    })
  }
  if (issue.completedAt) {
    entries.push({
      kind: "event",
      at: issue.completedAt,
      order: 2,
      text: "completed the issue",
      status: "done",
    })
  }
  if (issue.canceledAt) {
    entries.push({
      kind: "event",
      at: issue.canceledAt,
      order: 2,
      text: "canceled the issue",
      status: "canceled",
    })
  }
  for (const comment of comments) {
    entries.push({ kind: "comment", at: comment.createdAt, order: 3, comment })
  }
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order)
  const now = new Date()
  return (
    <Section title="Activity">
      <ol class="flex flex-col gap-3">
        {entries.map((entry) =>
          entry.kind === "event" ? (
            <li class="flex items-center gap-2.5 pl-1 text-[12px] text-ink-tertiary">
              <StatusIcon status={entry.status} />
              <span>
                {entry.text}
                <span class="mx-1.5">·</span>
                <time datetime={entry.at} title={entry.at}>
                  {relativeTime(entry.at, now)}
                </time>
              </span>
            </li>
          ) : (
            <li class="rounded-lg border border-hairline bg-surface-1 px-3.5 py-2.5">
              <div class="mb-1.5 flex items-center gap-2 text-[12px]">
                <Avatar name={entry.comment.author} />
                <span class="font-medium text-ink">{entry.comment.author}</span>
                {entry.comment.parent ? (
                  <span class="text-ink-tertiary">replied to {entry.comment.parent}</span>
                ) : null}
                <time datetime={entry.at} title={entry.at} class="text-ink-tertiary">
                  {relativeTime(entry.at, now)}
                </time>
              </div>
              <Markdown source={entry.comment.body} compact />
            </li>
          ),
        )}
      </ol>
    </Section>
  )
}
