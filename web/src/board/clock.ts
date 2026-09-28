// 板の期限と相対時刻の基準。ブラウザの現在時刻は使わない (docs/spec/routes.md の「サーバーの今」)
// 返事の now がまだ無いあいだは、期限を「今」として計算しない

const ISO_8601_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

export const UNLOADED_CLOCK = new Date(0)

export function serverNow(iso: string): Date {
  const parsedMilliseconds = Date.parse(iso)
  if (!ISO_8601_DATETIME.test(iso) || Number.isNaN(parsedMilliseconds)) {
    throw new Error(
      `invalid now: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual ${JSON.stringify(iso)}`,
    )
  }
  return new Date(parsedMilliseconds)
}

export function boardClock(iso: string | undefined): Date {
  if (iso === undefined || iso === "") return UNLOADED_CLOCK
  return serverNow(iso)
}
