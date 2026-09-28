import { tint } from "./tint"

// ラベルの色だけを小さな点で示す
// 色はワークスペースのラベルの一覧から labelColors で決めたものを color に渡す。一覧が無いときは名前の hash (tint) で決まる
export function LabelDot({ label, color }: { label: string; color?: string }) {
  return <span class="size-2 shrink-0 rounded-full" style={`background: ${color ?? tint(label)}`} />
}
