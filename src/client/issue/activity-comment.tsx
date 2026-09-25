import { Avatar } from "../../components/avatar"
import { Card } from "../../components/card"
import { Markdown } from "../../components/markdown"
import { RelativeTime } from "../../components/relative-time"
import type { Comment } from "../../store"

// 活動欄の 1 行のうち、コメントを 1 枚のカードで見せる。書いた人・返信先・時刻を上に、本文を Markdown で下に置く

export function ActivityComment({ comment, now }: { comment: Comment; now: Date }) {
  return (
    <Card as="li" class="px-3.5 py-2.5">
      <div class="mb-1.5 flex items-center gap-2 text-[12px]">
        <Avatar name={comment.author} />
        <span class="font-medium text-ink">{comment.author}</span>
        {comment.parent ? <span class="text-ink-tertiary">replied to {comment.parent}</span> : null}
        <RelativeTime at={comment.createdAt} now={now} class="text-ink-tertiary" />
      </div>
      <Markdown source={comment.body} compact />
    </Card>
  )
}
