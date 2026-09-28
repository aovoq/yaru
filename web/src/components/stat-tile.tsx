import { FOCUS_RING } from "./focus-ring"

// 数を 1 つ大きく見せる札。dashboard の先頭の件数 (lg) と、セッションの費用や割合 (md) で使う
// 答え待ちや期限切れのように、0 でないときに目を引きたい数は tone で色を変える
// note は割合の分母のように、数の下に添える内訳
// href を渡すと札そのものをリンクにし、その数の中身 (dashboard の同じ画面のまとまり) へ飛べるようにする

export type StatTileTone = "plain" | "attention" | "danger"
export type StatTileSize = "lg" | "md"

const VALUE_TONES: Record<StatTileTone, string> = {
  plain: "text-ink",
  attention: "text-primary-hover",
  danger: "text-semantic-danger",
}

const VALUE_SIZES: Record<StatTileSize, string> = {
  lg: "text-2xl",
  md: "text-xl",
}

export function StatTile({
  label,
  value,
  note,
  tone = "plain",
  size = "lg",
  href,
}: {
  label: string
  value: string | number
  note?: string
  tone?: StatTileTone
  size?: StatTileSize
  href?: string
}) {
  const body = (
    <>
      <div class="text-[11px] text-ink-tertiary">{label}</div>
      <div class={`mt-0.5 ${VALUE_SIZES[size]} font-semibold tabular-nums ${VALUE_TONES[tone]}`}>
        {value}
      </div>
      {note !== undefined ? (
        <div class="mt-0.5 truncate text-[11px] text-ink-tertiary">{note}</div>
      ) : null}
    </>
  )
  const frame = "block rounded-lg border border-hairline bg-surface-1 px-3 py-2.5"
  if (href === undefined) return <div class={frame}>{body}</div>
  return (
    <a
      href={href}
      class={`${frame} no-underline transition-colors hover:border-hairline-strong hover:bg-surface-2 ${FOCUS_RING}`}
    >
      {body}
    </a>
  )
}
