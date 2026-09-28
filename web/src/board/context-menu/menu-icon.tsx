import { Avatar } from "../../components/avatar"
import { PriorityIcon } from "../../components/icons/priority-icon"
import { StatusIcon } from "../../components/icons/status-icon"
import { LabelDot } from "../../components/label-dot"
import type { MenuIcon } from "../issue-menu"

// メニューの項目の左に置くアイコン。issue-menu.ts が種類だけを決め、描き方はここで選ぶ
export function MenuIconView({ icon }: { icon: MenuIcon }) {
  if (icon.kind === "status") return <StatusIcon status={icon.status} />
  if (icon.kind === "priority") return <PriorityIcon priority={icon.priority} />
  if (icon.kind === "avatar") return <Avatar name={icon.name} />
  return <LabelDot label={icon.label} />
}
