import { relativeTime } from "../time"

// 「3h ago」のような相対時刻を time 要素で出す。hover で元の時刻を見られるよう title にも入れる
// issue 画面の活動欄と属性欄、dashboard のコミットとセッションの一覧で使う
// prefix は「Created 」「Answered 」のように、時刻の前に続けて読ませる言葉

export function RelativeTime({
  at,
  now,
  prefix = "",
  class: extra,
}: {
  at: string
  now: Date
  prefix?: string
  class?: string
}) {
  return (
    <time datetime={at} title={at} class={extra || undefined}>
      {prefix}
      {relativeTime(at, now)}
    </time>
  )
}
