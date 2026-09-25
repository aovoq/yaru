import type { Priority } from "../store"
import { PriorityIcon } from "./icons/priority-icon"

// 優先度をアイコンと文字で見せる。質問のカードの見出しの行で使う
// 色つきの札にすると、期限切れや危険の赤と並んだときにどれが警告か分からなくなるので、色は urgent のアイコンだけに残す
// アイコンは隣の文字と同じことを言うので読み上げから外す

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span class="inline-flex items-center gap-1 text-ink-subtle">
      <PriorityIcon priority={priority} decorative />
      {priority.replace(/^\w/, (character) => character.toUpperCase())}
    </span>
  )
}
