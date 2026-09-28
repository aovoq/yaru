import { renderToString } from "preact-render-to-string"
import { expect, test } from "vitest"
import { NotFoundPage, notFoundMessage } from "./not-found-page"

test("an unknown path says not found and links back", () => {
  const html = renderToString(<NotFoundPage pathname="/missing" />)
  expect(html).toContain('data-screen="not-found"')
  expect(html).toContain("not found")
  expect(html).toContain(">back<")
  expect(html).toContain('href="/"')
})

test("an unregistered workspace names the slug", () => {
  expect(notFoundMessage("/p/missing/", new Set(["app"]))).toBe("workspace not found: missing")
  expect(notFoundMessage("/p/missing/dashboard", new Set(["app"]))).toBe(
    "workspace not found: missing",
  )
  expect(notFoundMessage("/p/app/nope", new Set(["app"]))).toBe("not found")
  expect(notFoundMessage("/missing")).toBe("not found")
})
