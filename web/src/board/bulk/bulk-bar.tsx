import { Button } from "../../components/button"
import { CrossIcon } from "../../components/icons/cross-icon"
import { Kbd } from "../../components/kbd"
import type { PropertyField } from "../issue-menu"

// x と Shift+クリックでまとめて選んだ issue を、まとめて変える下の帯。選んだ数と、状態・優先度・担当・ラベルの選択を並べる
// 選択の面は、キーボードの s / p / a / l と同じもの (PropertyPicker) を押したボタンの上に開く
// スマホの下端のホームバーに重ならないよう、safe area の分だけ上げる
// 390px 幅でも選択を外す × まで横に送らずに見えるよう、スマホ幅ではボタンの左右の余白を詰める

const FIELDS: { field: PropertyField; label: string; key: string }[] = [
  { field: "status", label: "Status", key: "S" },
  { field: "priority", label: "Priority", key: "P" },
  { field: "assignee", label: "Assignee", key: "A" },
  { field: "labels", label: "Labels", key: "L" },
]

export function BulkBar({
  count,
  onPick,
  onClear,
}: {
  count: number
  onPick: (field: PropertyField, anchor: HTMLElement) => void
  onClear: () => void
}) {
  return (
    <div
      role="toolbar"
      aria-label={`${count} ${count === 1 ? "issue" : "issues"} selected`}
      class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-safe"
    >
      <div class="pointer-events-auto mb-4 flex max-w-full items-center gap-0.5 overflow-x-auto sm:gap-1 rounded-xl border border-hairline-strong bg-surface-3 p-1.5 shadow-2xl shadow-black/60">
        <span class="text-body shrink-0 px-1 font-medium sm:px-2 whitespace-nowrap text-ink">
          {count} selected
        </span>
        {FIELDS.map(({ field, label, key }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="shrink-0 max-sm:px-2"
            onClick={(event) => onPick(field, event.currentTarget)}
          >
            {label}
            <span class="hidden sm:inline">
              <Kbd>{key}</Kbd>
            </span>
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="shrink-0 max-sm:px-2"
          aria-label="Clear selection (Esc)"
          title="Clear selection (Esc)"
          onClick={onClear}
        >
          <CrossIcon />
        </Button>
      </div>
    </div>
  )
}
