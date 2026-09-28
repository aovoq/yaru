import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { Card } from "./card"

// 目を引きたいカードは枠全体を薄い危険の色にする。左端の帯のような飾りの線は使わない
test("a danger card tints its whole border instead of drawing a bar on one edge", () => {
  const html = renderToString(<Card danger>x</Card>)
  expect(html).toContain("data-danger")
  expect(html).toContain("border-semantic-danger/30")
  expect(html).not.toContain("border-hairline")
  expect(html).not.toContain("inset")
})

test("a plain card keeps the hairline border", () => {
  const html = renderToString(<Card>x</Card>)
  expect(html).toContain("border-hairline")
  expect(html).not.toContain("data-danger")
})
