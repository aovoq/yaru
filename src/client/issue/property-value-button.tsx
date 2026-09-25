import type { ComponentChildren } from "preact"
import { Button } from "../../components/button"
import type { PickerTriggerProps } from "./property-picker"

// 属性欄の値そのものを押して選択の面を開くボタン。値が無いときは placeholder を薄い字で出す
// 属性の行 (高さ 28px) にそろえ、hover で面を出して押せると分かるようにする。見た目は入力欄 (InlineInput) の hover にそろえる
// 名前は行の項目名 (labelledBy) と今の値を続けて読ませる。「Status In Progress」のように、何の値かが分かるようにするため

export function PropertyValueButton({
  trigger,
  labelledBy,
  empty = false,
  title,
  children,
}: {
  trigger: PickerTriggerProps
  labelledBy: string
  empty?: boolean
  title?: string
  children?: ComponentChildren
}) {
  return (
    <Button
      {...trigger}
      id={`${labelledBy}-value`}
      aria-labelledby={`${labelledBy} ${labelledBy}-value`}
      title={title}
      variant="plain"
      size="inline"
      align="start"
      class="h-7 w-full min-w-0 px-2 text-body hover:bg-surface-2"
    >
      <span
        class={`flex min-w-0 flex-1 items-center gap-1.5 truncate ${empty ? "text-ink-tertiary" : ""}`}
      >
        {children}
      </span>
    </Button>
  )
}
