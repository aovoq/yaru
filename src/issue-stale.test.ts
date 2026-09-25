import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_STALE_AFTER_MILLISECONDS,
  isIssueStale,
  parseStaleAfter,
  readStaleAfter,
} from "./issue-stale"
import { init } from "./store"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-stale-"))
  dirs.push(root)
  return init(root)
}

test("staleAfter accepts minutes, hours, and days", () => {
  expect(parseStaleAfter("30m")).toBe(30 * 60_000)
  expect(parseStaleAfter("2h")).toBe(2 * 3_600_000)
  expect(parseStaleAfter("3d")).toBe(3 * 86_400_000)
})

test("staleAfter rejects values without a unit or with an unknown one", () => {
  for (const value of ["24", "1w", "-1h", "0h", "h", "1.5h"]) {
    expect(() => parseStaleAfter(value)).toThrow(
      `invalid staleAfter: expected a positive duration such as 30m, 2h, or 1d, actual ${JSON.stringify(value)}`,
    )
  }
})

test("staleAfter defaults to 24 hours when config.yml does not set it", () => {
  const store = workspace()
  expect(DEFAULT_STALE_AFTER_MILLISECONDS).toBe(24 * 3_600_000)
  expect(readStaleAfter(store)).toBe(DEFAULT_STALE_AFTER_MILLISECONDS)
  writeFileSync(join(store.dir, "config.yml"), "notify: echo x\nstaleAfter: 90m\n")
  expect(readStaleAfter(store)).toBe(90 * 60_000)
})

test("only in progress issues become stale", () => {
  const updatedAt = "2026-09-20T00:00:00.000Z"
  const later = new Date("2026-09-21T00:00:00.001Z")
  const hour = 3_600_000
  expect(isIssueStale({ status: "in_progress", updatedAt }, later, 24 * hour)).toBe(true)
  expect(
    isIssueStale(
      { status: "in_progress", updatedAt },
      new Date("2026-09-21T00:00:00.000Z"),
      24 * hour,
    ),
  ).toBe(false)
  for (const status of ["backlog", "todo", "done", "canceled"]) {
    expect(isIssueStale({ status, updatedAt }, later, hour)).toBe(false)
  }
  // 手で書いた壊れた日時は古いと断定できないので、止まっているとは言わない
  expect(isIssueStale({ status: "in_progress", updatedAt: "" }, later, hour)).toBe(false)
})
