import { StatusIcon } from "../../components/icons/status-icon"
import { RelativeTime } from "../../components/relative-time"

// 活動欄の 1 行のうち、issue が作られた・始まった・終わったといった出来事を、その状態のアイコンと時刻で小さく示す

export function ActivityEvent({
  text,
  status,
  at,
  now,
}: {
  text: string
  status: string
  at: string
  now: Date
}) {
  return (
    <li class="flex items-center gap-2.5 pl-1 text-[12px] text-ink-tertiary">
      <StatusIcon status={status} />
      <span>
        {text}
        <span class="mx-1.5">·</span>
        <RelativeTime at={at} now={now} />
      </span>
    </li>
  )
}
