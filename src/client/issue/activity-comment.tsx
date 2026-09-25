import { Avatar } from "../../components/avatar"
import { Card } from "../../components/card"
import { Markdown } from "../../components/markdown"
import { RelativeTime } from "../../components/relative-time"
import type { Comment } from "../../store"

// 活動欄の 1 行のうち、コメントを 1 枚のカードで見せる。書いた人の頭文字の丸は活動欄の軸 (activity.tsx) に乗せ、
// カードの上に名前・返信先・時刻を、下に本文を Markdown で置く
// 本文の #<id> は issueHref で同じ板の中の issue へのリンクにする

export function ActivityComment({
  comment,
  now,
  issueHref,
}: {
  comment: Comment
  now: Date
  issueHref: (id: string) => string
}) {
  return (
    <li class="flex items-start gap-3">
      <span class="relative mt-2.5 grid size-[18px] shrink-0 place-items-center bg-canvas">
        <Avatar name={comment.author} />
      </span>
      <Card class="min-w-0 flex-1 px-3.5 py-2.5">
        <div class="mb-1.5 flex flex-wrap items-center gap-x-2 text-small">
          <span class="font-medium text-ink">{comment.author}</span>
          {comment.parent ? (
            <span class="text-ink-tertiary">replied to {comment.parent}</span>
          ) : null}
          <RelativeTime at={comment.createdAt} now={now} class="text-ink-tertiary" />
        </div>
        <Markdown source={comment.body} compact issueHref={issueHref} />
      </Card>
    </li>
  )
}
