import { expect, test } from "bun:test"
import { styles } from "./css"

// Tailwind は見本の HTML に現れたクラスしか CSS にしない。見本に描き忘れた部品のクラスは本番で黙って効かなくなる
test("the stylesheet generates the shared primitives' type scale, hit areas and touch sizes", async () => {
  const css = await styles()
  for (const selector of [
    ".text-micro",
    ".text-small",
    ".text-body",
    ".text-title",
    ".text-display",
    ".rounded-xs",
    ".h-11",
    ".sm\\:h-9",
    ".sm\\:text-body",
    ".after\\:-inset-1",
    ".pointer-coarse\\:after\\:-inset-3",
    ".focus-visible\\:outline-primary-hover",
    ".focus\\:border-primary",
    ".pt-safe",
    ".pb-safe",
  ]) {
    expect(css).toContain(selector)
  }
})

test("the stylesheet declares the bundled Inter with its character variants", async () => {
  const css = await styles()
  expect(css).toContain("@font-face")
  expect(css).toContain("/assets/inter-4.1.woff2")
  expect(css).toMatch(/"cv11",\s*"ss01"/)
})
