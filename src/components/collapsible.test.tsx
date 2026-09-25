import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { Collapsible } from "./collapsible"

// dashboard はスクリプト無しで描くので、開閉はブラウザの details と summary に任せる
test("the collapsible is a details element that opens without scripts", () => {
  const html = renderToString(
    <Collapsible summary={<span>Q8 title</span>}>
      <p>body</p>
    </Collapsible>,
  )
  expect(html).toMatch(
    /^<details[^>]*><summary[^>]*>.*Q8 title.*<\/summary>.*<p>body<\/p>.*<\/details>$/,
  )
  expect(html).not.toContain(" open")
})

test("the collapsible can start open", () => {
  expect(
    renderToString(
      <Collapsible summary="s" open>
        x
      </Collapsible>,
    ),
  ).toContain("<details open")
})
