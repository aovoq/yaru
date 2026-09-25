import { afterEach, expect, test } from "bun:test"
import { installTestDom } from "../test-dom"
import type { ComponentChild } from "preact"

// 外を押したときと Esc で閉じるのは、実際の DOM にイベントを送らないと確かめられないので happy-dom を使う
const window = installTestDom()

let container: HTMLElement

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  window.document.body.innerHTML = ""
})

async function mount(node: ComponentChild): Promise<void> {
  const { render } = await import("preact")
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(node, container)
  await settle()
}

// useEffect は描いた次の画面の更新 (requestAnimationFrame) のあとに動くので、それも待つ
async function settle(): Promise<void> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function pointerDown(target: Element): void {
  target.dispatchEvent(
    new window.PointerEvent("pointerdown", { bubbles: true }) as unknown as Event,
  )
}

async function popover(onClose: () => void) {
  const { Popover } = await import("./popover")
  const outside = window.document.createElement("button")
  window.document.body.appendChild(outside)
  await mount(
    <Popover open onClose={onClose} trigger={<button type="button">Status</button>}>
      <button type="button" data-inside="">
        inside
      </button>
    </Popover>,
  )
  return outside as unknown as HTMLElement
}

test("pressing outside the popover closes it", async () => {
  let closed = 0
  const outside = await popover(() => closed++)
  pointerDown(outside)
  expect(closed).toBe(1)
})

test("pressing inside the panel or on the trigger does not close it", async () => {
  let closed = 0
  await popover(() => closed++)
  pointerDown(container.querySelector("[data-inside]")!)
  pointerDown(container.querySelector("button")!)
  expect(closed).toBe(0)
})

test("Escape closes the popover, returns focus to the trigger and stays away from page shortcuts", async () => {
  let closed = 0
  let reachedDocument = 0
  const onDocumentKeyDown = () => reachedDocument++
  window.document.addEventListener("keydown", onDocumentKeyDown)
  await popover(() => closed++)
  const inside = container.querySelector<HTMLElement>("[data-inside]")!
  inside.focus()
  inside.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }) as unknown as Event,
  )
  window.document.removeEventListener("keydown", onDocumentKeyDown)
  expect(closed).toBe(1)
  expect(reachedDocument).toBe(0)
  expect(window.document.activeElement?.textContent).toBe("Status")
})

test("a closed popover draws only its trigger", async () => {
  const { Popover } = await import("./popover")
  await mount(
    <Popover open={false} onClose={() => {}} trigger={<button type="button">Status</button>}>
      <span data-inside="">inside</span>
    </Popover>,
  )
  expect(container.querySelector("[data-inside]")).toBeNull()
  expect(container.querySelector("[data-popover]")).toBeNull()
})

test("closing after picking inside the panel returns focus to the trigger", async () => {
  const { Popover } = await import("./popover")
  const draw = (open: boolean) => (
    <Popover open={open} onClose={() => {}} trigger={<button type="button">Status</button>}>
      <button type="button" data-inside="">
        inside
      </button>
    </Popover>
  )
  await mount(draw(true))
  container.querySelector<HTMLElement>("[data-inside]")!.focus()
  const { render } = await import("preact")
  render(draw(false), container)
  await settle()
  expect(window.document.activeElement?.textContent).toBe("Status")
})
