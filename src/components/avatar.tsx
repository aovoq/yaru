import { tint } from "./tint"

// 担当者の頭文字を色の丸で示す。色は color を渡さなければ名前から決まる
// 頭文字は字の大きさの段 (text-micro) の一番小さい 11px にし、18px の丸の中で上下に余白を残す
export function Avatar({ name, color }: { name: string; color?: string }) {
  return (
    <span
      title={name}
      class="grid size-[18px] shrink-0 place-items-center rounded-full text-micro leading-none font-medium text-white/90 uppercase select-none"
      style={`background: color-mix(in oklab, ${color ?? tint(name)} 45%, #17181a)`}
    >
      {[...name][0] ?? "?"}
    </span>
  )
}
