import { Window } from "happy-dom"
import { options } from "preact"

// 部品を実際の DOM に描いて確かめるテストのための DOM を用意する
// bun は全てのテストファイルを 1 つの process で動かすので、ファイルごとに別の window を作って globals を差し替え・戻しすると、
// 前のファイルで登録した event listener や requestAnimationFrame が別の window に残り、全体で回したときだけ落ちる
// そこで process の中で window を 1 つだけ作り、一度入れたら戻さない

const NAMES = [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLFormElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "InputEvent",
  "requestAnimationFrame",
  // preact/hooks は useEffect を動かすときに cancelAnimationFrame も呼ぶので、無いと効果が動かない
  "cancelAnimationFrame",
] as const

const KEY = "__yaruTestWindow"

export function installTestDom(): Window {
  const globals = globalThis as Record<string, unknown>
  const existing = globals[KEY] as Window | undefined
  if (existing) return existing
  const window = new Window({ url: "http://127.0.0.1/" })
  for (const name of NAMES) {
    globals[name] =
      name === "window" ? window : (window as unknown as Record<string, unknown>)[name]
  }
  // preact/hooks は読み込んだ時点で requestAnimationFrame があるかを 1 度だけ決め、無ければ効果を 100ms 後の setTimeout で動かす
  // DOM の無いテスト (CSS の見本を描くものなど) が先に preact/hooks を読むと、後の DOM のテストで効果が遅れて落ちるので、
  // 呼ぶたびに読まれる options.requestAnimationFrame で window のものを使わせる
  options.requestAnimationFrame = (callback: () => void) => {
    window.requestAnimationFrame(callback)
  }
  globals[KEY] = window
  return window
}
