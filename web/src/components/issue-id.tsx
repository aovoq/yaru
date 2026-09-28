// issue の番号を「#73」の形で見せる。一覧の行・カード・関係の一覧・パンくずで同じ見た目にそろえる
// 質問の番号 (Q8) は issue と取り違えないよう、この部品を使わずに Q を付けて出す
// 桁の違う番号を縦にそろえるため等幅の字にする

export function IssueId({ id, class: extra = "" }: { id: string; class?: string }) {
  return (
    <span
      class={["text-micro shrink-0 font-mono text-ink-tertiary", extra].filter(Boolean).join(" ")}
    >
      #{id}
    </span>
  )
}
