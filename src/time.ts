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

// 期限など、人に見せる日時。端末の地域の時刻で 09-25 18:00 のように短く出す
export function localDateTime(iso: string): string {
  const date = new Date(iso)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${month}-${day} ${hours}:${minutes}`
}
