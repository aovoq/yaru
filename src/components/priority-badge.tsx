import type { Priority } from "../store"
import { Pill } from "./pill"

const PRIORITY_CLASS: Record<Priority, string> = {
  urgent: "border-priority-urgent/40 text-priority-urgent",
  high: "border-priority-high/40 text-priority-high",
  medium: "border-priority-medium/40 text-priority-medium",
  low: "border-hairline text-priority-low",
}

// 優先度を色つきの小さな札で見せる

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Pill tone={null} class={PRIORITY_CLASS[priority]}>
      {priority}
    </Pill>
  )
}
