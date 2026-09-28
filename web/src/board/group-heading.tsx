import type { ComponentChildren } from "preact"
import type { Priority } from "../domain/issue"
import { PriorityIcon } from "../components/icons/priority-icon"
import { StatusIcon } from "../components/icons/status-icon"
import { LabelDot } from "../components/label-dot"
import type { IssueSection } from "./view-model"

// issue のまとまり (状態・優先度・ラベル) の見出し。まとまりのアイコン・名前・件数を横に並べる。板の列 (board-column.tsx) と一覧 (list-view.tsx) で使う
// アイコンのすぐ隣に名前があるので、アイコンは読み上げから外す (decorative)
// 帯の高さや背景は置く場所ごとに違うので class で渡し、列の + のような右端の操作は children で足す

export function GroupHeading({
  section,
  labelColors,
  class: extra = "",
  children,
}: {
  section: IssueSection
  labelColors: Map<string, string>
  class?: string
  children?: ComponentChildren
}) {
  return (
    <div class={["flex items-center gap-2", extra].filter(Boolean).join(" ")}>
      {icon(section, labelColors)}
      <h2 class="text-body font-medium tracking-tight text-ink">{section.title}</h2>
      <span class="text-small text-ink-tertiary tabular-nums">{section.issues.length}</span>
      {children}
    </div>
  )
}

function icon(section: IssueSection, labelColors: Map<string, string>): ComponentChildren {
  if (section.group === "status" && section.value !== null) {
    return <StatusIcon status={section.value} decorative />
  }
  if (section.group === "priority") {
    return <PriorityIcon priority={section.value as Priority | null} decorative />
  }
  if (section.group === "label" && section.value !== null) {
    return <LabelDot label={section.value} color={labelColors.get(section.value)} />
  }
  return null
}
