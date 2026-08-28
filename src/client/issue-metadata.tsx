import type { PropsWithChildren } from "hono/jsx"
import { isOverdue } from "../store"

export function DueStamp({ date }: { date: string | null }) {
  if (!date) return null
  const overdue = isOverdue(date)
  return (
    <span
      data-overdue={overdue ? "" : undefined}
      class={`font-mono text-[11px] ${overdue ? "text-semantic-danger" : "text-ink-subtle"}`}
    >
      {date}
    </span>
  )
}

export function LabelChip({ label }: { label: string }) {
  return (
    <span class="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2 py-px text-[11px] text-ink-subtle">
      <LabelDot label={label} />
      {label}
    </span>
  )
}

export function LabelDot({ label }: { label: string }) {
  return <span class="size-2 shrink-0 rounded-full" style={`background: ${tint(label)}`} />
}

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

const PALETTE = [
  "#4ea7fc",
  "#4cb782",
  "#f2c94c",
  "#f2994a",
  "#eb5757",
  "#de5d9c",
  "#a385e0",
  "#4cc3c9",
  "#95a2b3",
  "#6771c5",
]

export function tint(text: string): string {
  let hash = 0
  for (const character of text) hash = (hash * 776 + character.codePointAt(0)!) >>> 0
  return PALETTE[hash % PALETTE.length]!
}

export function Kbd({ children }: PropsWithChildren) {
  return (
    <kbd class="rounded-sm border border-hairline bg-surface-1 px-1 font-mono text-[10px] text-ink-tertiary">
      {children}
    </kbd>
  )
}
