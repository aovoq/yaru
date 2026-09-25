import { expect, test } from "bun:test"
import { Glob } from "bun"
import { classesMissingFromSamples, styles } from "./css"

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

// 部品の書いたクラスが見本に描かれているかを、ソースの文字列から確かめる。操作したあとや特定のデータのときにしか出ない部品の描き忘れを見つけるため
// 板のスクリプトの部品もサーバーだけで描く画面 (dashboard・Inbox など) も、クラスはソースの文字列に書くので、両方をここで拾える
// 文字列の中の Tailwind のクラスと同じ綴りの語 (部品の props の値や DOM の出来事の名前) は、CSS が要らないので除く
const WORDS_THAT_ARE_NOT_CLASSES = new Set([
  // Button の size、Chip の variant、ロゴの枠の形 (pwa.ts)
  "inline",
  "outline",
  "rounded",
  // DOM の出来事の名前 (property-picker.tsx)
  "resize",
  "blur",
  // 絞り込みの札の種類 (filter-chips.tsx)
  "filter",
])

test("every Tailwind class written in the source is drawn in the stylesheet samples", async () => {
  const tokens = new Set<string>()
  for await (const file of new Glob("**/*.{ts,tsx}").scan(import.meta.dir)) {
    if (/\.test\.tsx?$/.test(file) || file === "css.tsx") continue
    const source = await Bun.file(`${import.meta.dir}/${file}`).text()
    for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      // テンプレートの埋め込み (${...}) は実行するまで値が分からないので、区切りとして扱う
      const text = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, " ")
      for (const token of text.split(/\s+/)) {
        if (token && !WORDS_THAT_ARE_NOT_CLASSES.has(token)) tokens.add(token)
      }
    }
  }
  expect(await classesMissingFromSamples(tokens)).toEqual([])
})
