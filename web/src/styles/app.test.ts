import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { build } from "vite"

const webRoot = fileURLToPath(new URL("../..", import.meta.url))

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
  expect(css).toContain("/fonts/InterVariable.woff2")
  expect(css).toContain('"cv11"')
  expect(css).toContain('"ss01"')
  expect(css).toContain("@utility pt-safe")
  expect(css).toContain(".markdown")
})

test("the vite build emits web/dist with scanned classes and copies public as is", async () => {
  await build({ root: webRoot, logLevel: "error" })
  const assetDirectory = fileURLToPath(new URL("../../dist/assets/", import.meta.url))
  const names = readdirSync(assetDirectory)
  const stylesheetName = names.find((name) => name.endsWith(".css"))
  expect(stylesheetName).toBeTruthy()
  const stylesheet = readFileSync(`${assetDirectory}/${stylesheetName}`, "utf8")
  expect(stylesheet).toContain(".text-body")
  expect(stylesheet).toContain(".pt-safe")
  expect(stylesheet).toContain(".markdown")
  expect(stylesheet).toContain("/fonts/InterVariable.woff2")
  expect(stylesheet).not.toContain(".bg-orange-500")
  // フォントとアイコンは web/public に置き、ハッシュを付けずに dist の同じパスへ写す。Go はこれを配る
  for (const file of [
    "fonts/InterVariable.woff2",
    "icon.svg",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "manifest.webmanifest",
  ]) {
    const source = readFileSync(`${webRoot}/public/${file}`)
    const built = readFileSync(`${webRoot}/dist/${file}`)
    expect(Buffer.compare(source, built)).toBe(0)
  }
  expect(names).not.toContain("inter-4.1.woff2")
}, 60_000)
