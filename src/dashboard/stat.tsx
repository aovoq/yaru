// dashboard の先頭に並べる件数の札。答え待ちや期限切れのように、0 でないときに目を引きたい数を色で分ける

export type StatTone = "plain" | "attention" | "danger"

const VALUE_CLASS: Record<StatTone, string> = {
  plain: "text-ink",
  attention: "text-primary-hover",
  danger: "text-semantic-danger",
}

export function Stat({ label, value, tone }: { label: string; value: number; tone: StatTone }) {
  return (
    <div class="rounded-lg border border-hairline bg-surface-1 px-3 py-2.5">
      <div class="text-[11px] text-ink-tertiary">{label}</div>
      <div class={`mt-0.5 text-2xl font-semibold tabular-nums ${VALUE_CLASS[tone]}`}>{value}</div>
    </div>
  )
}
