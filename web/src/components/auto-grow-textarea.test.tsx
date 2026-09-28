import { afterEach, expect, test } from "vitest"
import { installTestDom } from "../test-dom"

// 高さを測り直す時機 (幅が変わったとき) は実際の DOM に描かないと確かめられないので happy-dom を使う
// happy-dom は配置を計算しないので、scrollHeight と ResizeObserver はこのテストの中だけで差し替える
const window = installTestDom()
const globals = globalThis as Record<string, unknown>

type ResizeCallback = (entries: { contentRect: { width: number } }[]) => void
const observers: { callback: ResizeCallback; disconnected: boolean }[] = []
class FakeResizeObserver {
  private record: { callback: ResizeCallback; disconnected: boolean }
  constructor(callback: ResizeCallback) {
    this.record = { callback, disconnected: false }
    observers.push(this.record)
  }
  observe(): void {}
  disconnect(): void {
    this.record.disconnected = true
  }
}

let container: HTMLElement | undefined

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  container = undefined
  window.document.body.innerHTML = ""
  observers.length = 0
  delete globals.ResizeObserver
})

async function settle(): Promise<void> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mount(value: string): Promise<HTMLTextAreaElement> {
  const { render } = await import("preact")
  const { AutoGrowTextarea } = await import("./auto-grow-textarea")
  if (!container) {
    container = window.document.createElement("div") as unknown as HTMLElement
    window.document.body.appendChild(container as never)
  }
  render(<AutoGrowTextarea value={value} onInput={() => {}} />, container)
  await settle()
  return container.querySelector("textarea")!
}

// 中身の高さを決め打ちにする。幅が縮んで折り返しが減った、のような変化をこれで表す
function setContentHeight(textarea: HTMLTextAreaElement, height: number): void {
  Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => height })
}

test("the height follows the content again when the width changes", async () => {
  globals.ResizeObserver = FakeResizeObserver
  const textarea = await mount("長い題名")
  const observer = observers.at(-1)!
  setContentHeight(textarea, 64)
  observer.callback([{ contentRect: { width: 300 } }])
  expect(textarea.style.height).toBe("64px")
  // 広げて 1 行に収まるようになったら、空いた分だけ縮む
  setContentHeight(textarea, 32)
  observer.callback([{ contentRect: { width: 600 } }])
  expect(textarea.style.height).toBe("32px")
})

test("a notice without a width change does not measure again", async () => {
  // 高さを変えると同じ要素の大きさの知らせがもう一度届く。そのたびに測り直すと知らせが止まらなくなる
  globals.ResizeObserver = FakeResizeObserver
  const textarea = await mount("題名")
  const observer = observers.at(-1)!
  setContentHeight(textarea, 32)
  observer.callback([{ contentRect: { width: 300 } }])
  setContentHeight(textarea, 90)
  observer.callback([{ contentRect: { width: 300 } }])
  expect(textarea.style.height).toBe("32px")
})

test("the height is measured again when the value is replaced, and the observer stops on unmount", async () => {
  globals.ResizeObserver = FakeResizeObserver
  const textarea = await mount("一つ目")
  setContentHeight(textarea, 48)
  await mount("別の issue の、折り返す長さの題名")
  expect(textarea.style.height).toBe("48px")
  const { render } = await import("preact")
  render(null, container!)
  expect(observers.every((observer) => observer.disconnected)).toBe(true)
})

test("without ResizeObserver the textarea still grows with its content", async () => {
  const textarea = await mount("題名")
  setContentHeight(textarea, 40)
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }) as never)
  expect(textarea.style.height).toBe("40px")
})
