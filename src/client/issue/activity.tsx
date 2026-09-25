import { StatusIcon } from "../../components/icons/status-icon"
import { Section } from "../../components/section"
import type { IssueEvent } from "../../issue-events"
import type { Comment, Issue } from "../../store"
import { ActivityChangeIcon } from "./activity-change-icon"
import { ActivityComment } from "./activity-comment"
import { ActivityEvent } from "./activity-event"
import { activityEntries, describeIssueEvent } from "./activity-entries"

// issue 画面の活動欄。出来事・属性の変更・コメントを 1 本の流れで見せる
// 並べる順と言い方は activity-entries.ts で決める
// 行の頭のアイコンとコメントの頭文字の丸を 1 本の縦の軸にそろえ、軸には細い線を引いて時間の流れに見せる
// 線は ol の ::before で描き、丸の中心 (18px の半分) を通す

export function Activity({
  issue,
  comments,
  events,
  issueHref,
  now,
}: {
  issue: Issue
  comments: Comment[]
  events: IssueEvent[]
  issueHref: (id: string) => string
  now: Date
}) {
  return (
    <Section title="Activity">
      <ol class="relative flex flex-col gap-3 before:absolute before:top-2 before:bottom-2 before:left-[8.5px] before:w-px before:bg-hairline">
        {activityEntries(issue, comments, events).map((entry) => {
          if (entry.kind === "comment") {
            return (
              <ActivityComment
                key={entry.key}
                comment={entry.comment}
                now={now}
                issueHref={issueHref}
              />
            )
          }
          if (entry.kind === "change") {
            return (
              <ActivityEvent
                key={entry.key}
                icon={<ActivityChangeIcon event={entry.event} />}
                at={entry.at}
                now={now}
              >
                <span class="text-ink-subtle">{entry.event.by}</span>{" "}
                {describeIssueEvent(entry.event)}
              </ActivityEvent>
            )
          }
          return (
            <ActivityEvent
              key={entry.key}
              icon={<StatusIcon status={entry.status} decorative />}
              at={entry.at}
              now={now}
            >
              {entry.text}
            </ActivityEvent>
          )
        })}
      </ol>
    </Section>
  )
}
