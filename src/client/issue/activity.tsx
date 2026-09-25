import { Section } from "../../components/section"
import type { Comment, Issue } from "../../store"
import { ActivityComment } from "./activity-comment"
import { ActivityEvent } from "./activity-event"
import { activityEntries } from "./activity-entries"

// issue 画面の活動欄。状態が変わった出来事とコメントを 1 本の流れで見せる
// 並べる順は activity-entries.ts で決める

export function Activity({ issue, comments }: { issue: Issue; comments: Comment[] }) {
  const now = new Date()
  return (
    <Section title="Activity">
      <ol class="flex flex-col gap-3">
        {activityEntries(issue, comments).map((entry) =>
          entry.kind === "event" ? (
            <ActivityEvent
              key={`event-${entry.text}`}
              text={entry.text}
              status={entry.status}
              at={entry.at}
              now={now}
            />
          ) : (
            <ActivityComment
              key={`comment-${entry.comment.id}`}
              comment={entry.comment}
              now={now}
            />
          ),
        )}
      </ol>
    </Section>
  )
}
