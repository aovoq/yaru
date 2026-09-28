import { useState } from "preact/hooks"
import { IconButton } from "../components/icon-button"
import { PlusIcon } from "../components/icons/plus-icon"
import type { Issue } from "../domain/issue"
import { PropertyPicker } from "./property-picker"
import { issueOptions } from "./property-options"
import { RelationKindSwitch, type RelationKind } from "./relation-kind-switch"

// 関係の欄の + で開く、止めている issue・止められている issue を選ぶ面

export function RelationPicker({
  issue,
  all,
  onToggle,
}: {
  issue: Issue
  all: Issue[]
  onToggle: (kind: RelationKind, otherId: string) => void
}) {
  const [kind, setKind] = useState<RelationKind>("blockedBy")
  return (
    <PropertyPicker
      label={kind === "blocks" ? "Blocks" : "Blocked by"}
      multiple
      placeholder="Search issues…"
      options={issueOptions(all, new Set([issue.id]))}
      selected={kind === "blocks" ? issue.blocks : issue.blockedBy}
      align="end"
      onSelect={(otherId) => onToggle(kind, otherId)}
      header={<RelationKindSwitch kind={kind} onChange={setKind} />}
      trigger={(trigger) => (
        <IconButton label="Add relation" {...trigger}>
          <PlusIcon />
        </IconButton>
      )}
    />
  )
}
