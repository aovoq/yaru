import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { Card } from "./card"

// 枠全体を赤くすると並んだカードが全部警告に見えるので、枠は細い線のまま左端の帯だけで目を引く
test("a danger card keeps the hairline border and adds a bar on its left edge", () => {
  const html = renderToString(<Card danger>x</Card>)
  expect(html).toContain("border-hairline")
  expect(html).toContain("data-danger")
  expect(html).not.toContain("border-semantic-danger")
})
