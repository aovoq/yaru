import { expect, test } from "vitest"
import { renderToString } from "preact-render-to-string"
import { PriorityIcon } from "./priority-icon"
import { StatusIcon } from "./status-icon"

test("the status icon is read out by its status name", () => {
  const html = renderToString(<StatusIcon status="in_progress" />)
  expect(html).toContain('role="img"')
  expect(html).toContain('aria-label="In Progress"')
})

test("a decorative status icon next to its own label is hidden from screen readers", () => {
  const html = renderToString(<StatusIcon status="done" decorative />)
  expect(html).toContain('aria-hidden="true"')
  expect(html).not.toContain("aria-label")
})

test("the priority icon is read out by its priority", () => {
  const html = renderToString(<PriorityIcon priority="high" />)
  expect(html).toContain('role="img"')
  expect(html).toContain('aria-label="High priority"')
  expect(html).toContain('data-priority="high"')
})

test("no priority is drawn as dashes instead of nothing so the column stays aligned", () => {
  const html = renderToString(<PriorityIcon priority={null} />)
  expect(html).toContain('data-priority="none"')
  expect(html).toContain('aria-label="No priority"')
})

test("unlit priority bars are faint so the lit ones read clearly", () => {
  const html = renderToString(<PriorityIcon priority="low" />)
  expect(html).toContain('fill-opacity="0.2"')
  expect(html).not.toContain('fill-opacity="0.3"')
})

test("a decorative priority icon is hidden from screen readers", () => {
  const html = renderToString(<PriorityIcon priority="urgent" decorative />)
  expect(html).toContain('aria-hidden="true"')
  expect(html).not.toContain("aria-label")
})
