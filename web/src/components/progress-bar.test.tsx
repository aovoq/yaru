import { expect, test } from "vitest"
import { renderToString } from "preact-render-to-string"
import { ProgressBar } from "./progress-bar"

test("the progress bar tells screen readers what it measures and how far along it is", () => {
  const html = renderToString(<ProgressBar value={2} max={5} label="Sub-issues done" />)
  expect(html).toContain('role="progressbar"')
  expect(html).toContain('aria-label="Sub-issues done"')
  expect(html).toContain('aria-valuetext="2 of 5"')
  expect(html).toContain("width: 40%")
})
