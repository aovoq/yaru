import { afterEach, expect, test } from "bun:test"
import { currentTime } from "./time"

const originalYaruNow = process.env.YARU_NOW

afterEach(() => {
  if (originalYaruNow === undefined) delete process.env.YARU_NOW
  else process.env.YARU_NOW = originalYaruNow
})

test("currentTime follows the clock when YARU_NOW is unset", () => {
  delete process.env.YARU_NOW
  const before = Date.now()
  const actual = currentTime().getTime()
  const after = Date.now()
  expect(actual).toBeGreaterThanOrEqual(before)
  expect(actual).toBeLessThanOrEqual(after)
})

test("currentTime returns the instant in YARU_NOW", () => {
  process.env.YARU_NOW = "2026-09-28T12:00:00.000Z"
  expect(currentTime().toISOString()).toBe("2026-09-28T12:00:00.000Z")
})

test("currentTime accepts an ISO 8601 datetime with a numeric offset", () => {
  process.env.YARU_NOW = "2026-09-28T21:00:00+09:00"
  expect(currentTime().toISOString()).toBe("2026-09-28T12:00:00.000Z")
})

test("currentTime rejects a YARU_NOW that is not a datetime", () => {
  process.env.YARU_NOW = "yesterday"
  expect(() => currentTime()).toThrow(
    'invalid YARU_NOW: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual "yesterday"',
  )
})

test("currentTime rejects a calendar date that does not exist", () => {
  process.env.YARU_NOW = "2026-02-30T12:00:00Z"
  expect(() => currentTime()).toThrow(
    'invalid YARU_NOW: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual "2026-02-30T12:00:00Z"',
  )
})

test("currentTime accepts February 29 in a leap year", () => {
  process.env.YARU_NOW = "2024-02-29T12:00:00Z"
  expect(currentTime().toISOString()).toBe("2024-02-29T12:00:00.000Z")
})
