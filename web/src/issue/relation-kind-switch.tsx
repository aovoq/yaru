import { Button } from "../components/button"

// 関係の面の上に置く、Blocked by と Blocks の切り替え
// https://www.w3.org/WAI/ARIA/apg/patterns/button/

export type RelationKind = "blockedBy" | "blocks"

const KINDS: { kind: RelationKind; label: string }[] = [
  { kind: "blockedBy", label: "Blocked by" },
  { kind: "blocks", label: "Blocks" },
]

export function RelationKindSwitch({
  kind,
  onChange,
}: {
  kind: RelationKind
  onChange: (kind: RelationKind) => void
}) {
  return (
    <div role="group" aria-label="Relation" class="mb-1 flex gap-1 px-1 pt-1">
      {KINDS.map((item) => (
        <Button
          key={item.kind}
          size="xs"
          variant={kind === item.kind ? "secondary" : "ghost"}
          aria-pressed={kind === item.kind ? "true" : "false"}
          onClick={() => onChange(item.kind)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  )
}
