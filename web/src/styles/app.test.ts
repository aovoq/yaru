import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { build } from "vite"

const webRoot = fileURLToPath(new URL("../..", import.meta.url))
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url))

// 見本の HTML を描いてクラスを拾う仕組み (src/css.tsx の sampleHtml) は使わない。
// Tailwind 4 は CSS の @source で web/src を走査する。
test("the stylesheet source sets tokens and scans source files instead of a sample catalog", () => {
  const css = readFileSync(new URL("./app.css", import.meta.url), "utf8")
  expect(css).toContain('@import "tailwindcss" source(none)')
  expect(css).toContain("@source")
  expect(css).not.toContain("sampleHtml")
  expect(css).not.toContain("renderToString")
  expect(css).toContain("--color-canvas: #010102")
  expect(css).toContain("--color-ink: #f7f8f8")
  expect(css).toContain("--text-body: 13px")
  expect(css).toContain("--radius-md: 8px")
  expect(css).toContain("/assets/inter-4.1.woff2")
  expect(css).toContain('"cv11"')
  expect(css).toContain('"ss01"')
  expect(css).toContain("@utility pt-safe")
  expect(css).toContain(".markdown")
})

test("the vite build emits web/dist with scanned classes and the unhashed Inter file", async () => {
  await build({ root: webRoot, logLevel: "error" })
  const assetDirectory = fileURLToPath(new URL("../../dist/assets/", import.meta.url))
  const names = readdirSync(assetDirectory)
  const stylesheetName = names.find((name) => name.endsWith(".css"))
  expect(stylesheetName).toBeTruthy()
  const stylesheet = readFileSync(`${assetDirectory}/${stylesheetName}`, "utf8")
  expect(stylesheet).toContain(".text-body")
  expect(stylesheet).toContain(".pt-safe")
  expect(stylesheet).toContain(".markdown")
  expect(stylesheet).toContain("/assets/inter-4.1.woff2")
  expect(stylesheet).not.toContain(".bg-orange-500")
  const sourceFont = readFileSync(`${repoRoot}/assets/fonts/InterVariable.woff2`)
  const builtFont = readFileSync(`${assetDirectory}/inter-4.1.woff2`)
  expect(Buffer.compare(sourceFont, builtFont)).toBe(0)
}, 60_000)
