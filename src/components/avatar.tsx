import { tint } from "./tint"

// 担当者の頭文字を、名前から決まる色の丸で示す
export function Avatar({ name }: { name: string }) {
  return (
    <span
      title={name}
      class="grid size-[18px] shrink-0 place-items-center rounded-full text-[9px] font-medium text-white/90 uppercase select-none"
      style={`background: color-mix(in oklab, ${tint(name)} 45%, #17181a)`}
    >
      {[...name][0] ?? "?"}
    </span>
  )
}
