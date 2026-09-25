import { tint } from "./tint"

// ラベルの色だけを小さな点で示す。色は名前から決まる
export function LabelDot({ label }: { label: string }) {
  return <span class="size-2 shrink-0 rounded-full" style={`background: ${tint(label)}`} />
}
