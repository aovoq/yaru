import { InboxScreen } from "../inbox/inbox-screen"
import type { InboxQuery } from "../route"

// /inbox。中身は web/src/inbox
export function InboxPage({ query, fragment }: { query: InboxQuery; fragment: string | null }) {
  return (
    <div
      class="contents"
      data-screen="inbox"
      data-workspace={query.workspace ?? undefined}
      data-question={query.questionId ?? undefined}
      data-error={query.error ?? undefined}
      data-answer={query.answer ?? undefined}
      data-answered={query.answered ?? undefined}
      data-fragment={fragment ?? undefined}
    >
      <InboxScreen query={query} fragment={fragment} />
    </div>
  )
}
