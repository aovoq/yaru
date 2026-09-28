import { expect, test } from "vitest"
import { renderToString } from "preact-render-to-string"
import { IssueId } from "./issue-id"

test("the issue id is shown with a leading hash in monospace", () => {
  const html = renderToString(<IssueId id="73" />)
  expect(html).toContain(">#73<")
  expect(html).toContain("font-mono")
})
