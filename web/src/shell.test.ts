import { readFileSync } from "node:fs"
import { expect, test } from "vitest"

// docs/spec/security.md: 文書応答にインラインの script を置かない。src/ui/document.tsx の外枠は残す。
test("index.html has no inline script and keeps the document shell", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8")
  expect(html).toContain('lang="ja"')
  expect(html).toContain("viewport-fit=cover")
  expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
  expect(html).toContain('href="/icon.svg"')
  expect(html).toContain('href="/apple-touch-icon.png"')
  expect(html).toContain('content="#010102"')
  expect(html).toContain("/fonts/InterVariable.woff2")
  expect(html).not.toMatch(/<style[\s>]/)
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
})
