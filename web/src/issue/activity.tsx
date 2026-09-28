import { StatusIcon } from "../components/icons/status-icon"
import { Section } from "../components/section"
import type { Issue } from "../domain/issue"
import { ActivityChangeIcon } from "./activity-change-icon"
import { ActivityComment } from "./activity-comment"
import { ActivityEvent } from "./activity-event"
import { activityEntries, describeIssueEvent } from "./activity-entries"
import type { Comment, IssueEvent } from "./model"

// 出来事・属性の変更・コメントを 1 本の流れで見せる。軸の線は ol の ::before で描く

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
