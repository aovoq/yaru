import { readConfigValue } from "./config"
import type { Store } from "./store"

// 進行中 (in_progress) のまま長く更新されていない issue を「止まっている」とみなす
// エージェントが途中で落ちたり人の返事を待ったまま忘れられたりすると、板の上では進行中のまま残り、人が気づけないため
// どれだけ経てば止まっているとみなすかは .yaru/config.yml の staleAfter (30m / 2h / 1d) で決める

export const DEFAULT_STALE_AFTER_MILLISECONDS = 24 * 3_600_000

const DURATION_UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

export function parseStaleAfter(value: string): number {
  const match = value.trim().match(/^(\d+)([mhd])$/)
  const amount = match ? Number(match[1]) : 0
  if (!match || amount <= 0) {
    throw new Error(
      `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual ${JSON.stringify(value)}`,
    )
  }
  return amount * DURATION_UNITS[match[2]!]!
}

export function readStaleAfter(store: Store): number {
  const value = readConfigValue(store, "staleAfter")
  return value === null ? DEFAULT_STALE_AFTER_MILLISECONDS : parseStaleAfter(value)
}

export function isIssueStale(
  issue: { status: string; updatedAt: string },
  now: Date,
  staleAfterMilliseconds: number,
): boolean {
  if (issue.status !== "in_progress") return false
  const updatedAt = Date.parse(issue.updatedAt)
  // 手で書いた壊れた日時は古いと断定できないので、止まっているとは言わない
  if (Number.isNaN(updatedAt)) return false
  return now.getTime() - updatedAt > staleAfterMilliseconds
}
