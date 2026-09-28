import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { Button, buttonClass, INLINE_VARIANTS } from "./button"

// inline は枠も余白も持たないので、地の色や枠のある種類と組むと字が縁に触れてはみ出して見える。字だけの種類に限る
test("inline pairs only with the text-only variants", () => {
  expect(INLINE_VARIANTS).toEqual(["text", "plain"])
  // @ts-expect-error primary は地の色を持つので inline と組めない
  buttonClass("primary", "inline")
  // @ts-expect-error secondary は枠を持つので inline と組めない
  buttonClass("secondary", "inline")
  // @ts-expect-error ghost は hover で地の色を持つので inline と組めない
  buttonClass("ghost", "inline")
  // @ts-expect-error variant を省くと secondary になるので inline と組めない
  renderToString(<Button size="inline">x</Button>)
})

// inline は字の大きさを周りに合わせるので、大きさや余白のクラスを持たない
test("an inline button carries no padding or font size of its own", () => {
  const classes = buttonClass("plain", "inline").split(" ")
  expect(classes).not.toContain("px-1")
  expect(classes).not.toContain("text-micro")
  expect(classes).toContain("rounded-xs")
})
