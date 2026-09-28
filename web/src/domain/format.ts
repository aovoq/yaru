// 数を画面に出す文字列へ整える。dashboard のセッションの費用や割合で使う (src/format.ts)

export function usd(value: number): string {
  return `$${value.toFixed(2)}`
}

// 分母が 0 で割合が決まらないとき (null) は、0% と取り違えないよう「-」を出す
export function percent(ratio: number | null): string {
  return ratio === null ? "-" : `${(ratio * 100).toFixed(1)}%`
}
