import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { AwaitingBadge } from "./awaiting-badge"

const NOW = new Date("2026-09-26T03:00:00.000Z")

test("the badge shows the time left before the soonest deadline", () => {
  const html = renderToString(
    <AwaitingBadge
      summary={{ count: 1, expired: 0, soonestAnswerBy: "2026-09-26T05:30:00.000Z" }}
      now={NOW}
    />,
  )
  expect(html).toContain("2h 30m")
  expect(html).not.toContain("semantic-danger")
  expect(html).toContain("1 question awaiting answer, next due in 2h 30m")
})

test("the badge turns to the danger color when a question passed its deadline", () => {
  const html = renderToString(
    <AwaitingBadge summary={{ count: 2, expired: 1, soonestAnswerBy: null }} now={NOW} />,
  )
  expect(html).toContain("semantic-danger")
  expect(html).toContain("2 questions awaiting answer, 1 past the deadline")
})

test("a question without a deadline shows only the question mark and the count", () => {
  const html = renderToString(
    <AwaitingBadge summary={{ count: 3, expired: 0, soonestAnswerBy: null }} now={NOW} />,
  )
  expect(html).toContain("3 questions awaiting answer")
  expect(html).toMatch(/>\?</)
})

test("a deadline that passed after the board was loaded is shown in the danger color without a negative time", () => {
  const html = renderToString(
    <AwaitingBadge
      summary={{ count: 1, expired: 0, soonestAnswerBy: "2026-09-26T02:00:00.000Z" }}
      now={NOW}
    />,
  )
  expect(html).toContain("semantic-danger")
  expect(html).not.toContain("ago")
})
