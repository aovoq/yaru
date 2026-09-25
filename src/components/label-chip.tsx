import { LabelDot } from "./label-dot"
import { Pill } from "./pill"

// ラベルの名前を色の点と一緒に丸い枠で示す
// 色はワークスペースのラベルの一覧から labelColors で決めたものを color に渡す。渡さなければ名前の hash (tint) で決まる
export function LabelChip({ label, color }: { label: string; color?: string }) {
  return (
    <Pill>
      <LabelDot label={label} color={color} />
      {label}
    </Pill>
  )
}
