import { LabelDot } from "./label-dot"
import { Pill } from "./pill"

// ラベルの名前を色の点と一緒に丸い枠で示す
export function LabelChip({ label }: { label: string }) {
  return (
    <Pill>
      <LabelDot label={label} />
      {label}
    </Pill>
  )
}
