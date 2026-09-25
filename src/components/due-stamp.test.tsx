import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { DueStamp } from "./due-stamp"

const NOW = new Date(2026, 8, 26, 12, 0, 0)

test("a passed due date on an unfinished issue is marked overdue in color and in words", () => {
  const html = renderToString(<DueStamp date="2026-09-20" status="todo" now={NOW} />)
  expect(html).toContain("data-overdue")
  expect(html).toContain("text-semantic-danger")
  // 色だけに頼らず、読み上げでも期限切れと分かるようにする
  expect(html).toContain('<span class="sr-only">Overdue: </span>')
})

test("a finished issue is not marked overdue even when its due date has passed", () => {
  for (const status of ["done", "canceled"]) {
    const html = renderToString(<DueStamp date="2026-09-20" status={status} now={NOW} />)
    expect(html).not.toContain("data-overdue")
    expect(html).not.toContain("text-semantic-danger")
    expect(html).not.toContain("Overdue")
  }
})

test("the due date is shown as a short date with the ISO date on hover", () => {
  const html = renderToString(<DueStamp date="2026-10-20" status="todo" now={NOW} />)
  expect(html).toContain(">Oct 20<")
  expect(html).toContain('datetime="2026-10-20"')
  expect(html).toContain('title="2026-10-20"')
})

test("nothing is drawn without a due date", () => {
  expect(renderToString(<DueStamp date={null} status="todo" now={NOW} />)).toBe("")
})
