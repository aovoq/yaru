import { expect, test } from "vitest"
import { renderToString } from "preact-render-to-string"
import { Notice } from "./notice"

// 読み上げは、あとから差し込まれた live region の最初の中身を読まないことがあるので、知らせが無いときも領域は置いておく
test("the live region is present even when there is nothing to announce", () => {
  const html = renderToString(<Notice text={null} />)
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-live="polite"')
  expect(html).not.toContain("<p")
})

test("a notice is shown inside the live region", () => {
  const html = renderToString(<Notice text="Copied" />)
  expect(html).toMatch(/role="status"[^>]*>.*>Copied</)
})
