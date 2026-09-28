import { expect, test } from "vitest"
import { LABEL_PALETTE, labelColors, tint } from "./tint"

// 期限切れ・優先度・状態・primary と同じ色をラベルに使うと、ラベルが警告や状態に見えてしまう
const RESERVED_COLORS = [
  "#eb5757",
  "#f2994a",
  "#f2c94c",
  "#8a8f98",
  "#5e6ad2",
  "#828fff",
  "#27a644",
]

test("the label palette avoids the colors reserved for danger, priority, status and primary", () => {
  for (const color of LABEL_PALETTE) expect(RESERVED_COLORS).not.toContain(color)
  expect(new Set(LABEL_PALETTE).size).toBe(LABEL_PALETTE.length)
})

test("labels in one workspace get distinct colors while they fit in the palette", () => {
  const labels = LABEL_PALETTE.map((_, index) => `label-${index}`)
  const colors = labelColors(labels)
  expect(new Set(colors.values()).size).toBe(LABEL_PALETTE.length)
})

// サーバーの描画とブラウザの描画で色が変わると引き継ぎが食い違うので、並びは渡した順にも locale にもよらない
test("label colors depend only on the set of names, not on their order or duplicates", () => {
  const forward = labelColors(["ui", "Bug", "api", "bug"])
  const backward = labelColors(["bug", "api", "Bug", "ui", "ui"])
  expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort())
  // code point の順 (大文字が先) で並べて先頭から palette を割り当てる
  expect(forward.get("Bug")).toBe(LABEL_PALETTE[0])
  expect(forward.get("api")).toBe(LABEL_PALETTE[1])
})

test("tint falls back to a palette color derived from the name", () => {
  expect(LABEL_PALETTE).toContain(tint("anything"))
  expect(tint("same")).toBe(tint("same"))
})
