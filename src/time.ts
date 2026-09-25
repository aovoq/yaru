// 画面に出す「3h ago」「in 2h」のような相対時刻。サーバーの描画とブラウザの両方で使う
export function relativeTime(iso: string, now: Date): string {
  const target = Date.parse(iso)
  if (Number.isNaN(target)) return "-"
  const difference = target - now.getTime()
  const minutes = Math.round(Math.abs(difference) / 60_000)
  const span =
    minutes < 1
      ? "now"
      : minutes < 60
        ? `${minutes}m`
        : minutes < 60 * 48
          ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
          : `${Math.floor(minutes / (60 * 24))}d`
  if (span === "now") return "now"
  return difference >= 0 ? `in ${span}` : `${span} ago`
}
