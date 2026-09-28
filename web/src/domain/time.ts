// 画面に出す相対時刻。計算は src/time.ts:48-73 と同じ
// 期限と相対時刻の基準は、ブラウザの現在時刻ではなく返事の now (docs/spec/routes.md の「サーバーの今」)
// currentTime は src/time.ts:7-21 と同じで、部品の既定引数に残している。画面を作る側は now を渡す

const ISO_8601_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

export function currentTime(): Date {
  const yaruNow = readYaruNow()
  if (yaruNow === undefined) return new Date()
  const parsedMilliseconds = Date.parse(yaruNow)
  if (
    ISO_8601_DATETIME.test(yaruNow) &&
    !Number.isNaN(parsedMilliseconds) &&
    clockFieldsMatch(yaruNow, parsedMilliseconds)
  ) {
    return new Date(parsedMilliseconds)
  }
  throw new Error(
    `invalid YARU_NOW: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual ${JSON.stringify(yaruNow)}`,
  )
}

function clockFieldsMatch(value: string, parsedMilliseconds: number): boolean {
  const wallClock = new Date(parsedMilliseconds + offsetMinutes(value) * 60_000)
  return (
    wallClock.getUTCFullYear() === Number(value.slice(0, 4)) &&
    wallClock.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
    wallClock.getUTCDate() === Number(value.slice(8, 10)) &&
    wallClock.getUTCHours() === Number(value.slice(11, 13)) &&
    wallClock.getUTCMinutes() === Number(value.slice(14, 16)) &&
    wallClock.getUTCSeconds() === Number(value.slice(17, 19))
  )
}

function offsetMinutes(value: string): number {
  if (value.endsWith("Z")) return 0
  const sign = value.at(-6) === "+" ? 1 : -1
  const hours = Number(value.slice(-5, -3))
  const minutes = Number(value.slice(-2))
  return sign * (hours * 60 + minutes)
}

function readYaruNow(): string | undefined {
  if (typeof process === "undefined" || process.env === undefined) return undefined
  return process.env.YARU_NOW
}

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

export function localDateTime(iso: string): string {
  const date = new Date(iso)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${month}-${day} ${hours}:${minutes}`
}
