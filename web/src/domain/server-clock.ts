// 返事の now を時刻の基準にする。ブラウザの現在時刻 (new Date() の引数なし) は使わない
// docs/spec/routes.md の「サーバーの今」

export type ServerClock = {
  now: () => Date
}

export function serverClock(nowIso: string, monotonicNow: () => number): ServerClock {
  const origin = Date.parse(nowIso)
  const started = monotonicNow()
  return {
    now: () => new Date(origin + (monotonicNow() - started)),
  }
}

export function browserMonotonic(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now()
  }
  return 0
}

export function dateFromIso(nowIso: string): Date {
  return new Date(Date.parse(nowIso))
}
