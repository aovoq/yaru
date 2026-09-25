import { afterEach, expect, test } from "bun:test"
import { installTestDom } from "../test-dom"
import type { ComponentChild } from "preact"
import type { ComboboxOption } from "./combobox"

// キーボードでの絞り込みと選択は、実際の DOM にイベントを送らないと確かめられないので happy-dom を使う
const window = installTestDom()

let container: HTMLElement

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  window.document.body.innerHTML = ""
})

const STATUSES: ComboboxOption[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress", keywords: ["doing"] },
  { value: "done", label: "Done" },
]

async function mount(node: ComponentChild): Promise<void> {
  const { render } = await import("preact")
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(node, container)
  await settle()
}

// preact の state の更新は次のタスクで描き直され、useEffect は描いた次の画面の更新 (requestAnimationFrame) のあとに動くので、それも待つ
async function settle(): Promise<void> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function input(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[role="combobox"]')!
}

async function type(text: string): Promise<void> {
  const element = input()
  element.value = text
  element.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  await settle()
}

async function press(key: string, options: { isComposing?: boolean } = {}): Promise<KeyboardEvent> {
  const event = new window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    isComposing: options.isComposing ?? false,
  }) as unknown as KeyboardEvent
  input().dispatchEvent(event)
  await settle()
  return event
}

function visibleLabels(): string[] {
  return [...container.querySelectorAll('[role="option"]')].map(
    (option) => option.textContent ?? "",
  )
}

test("typing narrows the options by label and keyword", async () => {
  const { Combobox } = await import("./combobox")
  await mount(<Combobox label="Status" options={STATUSES} selected={[]} onSelect={() => {}} />)
  // 開いたらすぐ打てるよう、検索欄に focus が入っている
  expect(window.document.activeElement as unknown).toBe(input())
  await type("do")
  expect(visibleLabels()).toEqual(["Todo", "In Progress", "Done"])
  await type("doing")
  expect(visibleLabels()).toEqual(["In Progress"])
})

test("arrow keys move the active option and Enter selects it", async () => {
  const { Combobox } = await import("./combobox")
  const picked: string[] = []
  await mount(
    <Combobox
      label="Status"
      options={STATUSES}
      selected={[]}
      onSelect={(value) => picked.push(value)}
    />,
  )
  await press("ArrowDown")
  await press("ArrowDown")
  const active = container.querySelector('[role="option"][data-active]')!
  expect(active.textContent).toBe("In Progress")
  expect(input().getAttribute("aria-activedescendant")).toBe(active.id)
  await press("ArrowUp")
  await press("ArrowUp")
  await press("ArrowUp")
  // 先頭から上へ動かすと末尾へ回る
  expect(container.querySelector('[role="option"][data-active]')!.textContent).toBe("Done")
  await press("Enter")
  expect(picked).toEqual(["done"])
})

test("Enter picks the first match after typing", async () => {
  const { Combobox } = await import("./combobox")
  const picked: string[] = []
  await mount(
    <Combobox
      label="Status"
      options={STATUSES}
      selected={["backlog"]}
      onSelect={(value) => picked.push(value)}
    />,
  )
  await type("don")
  await press("Enter")
  expect(picked).toEqual(["done"])
})

// 日本語の変換を確定する Enter で選んでしまわないようにする
test("Enter while composing text does not select", async () => {
  const { Combobox } = await import("./combobox")
  const picked: string[] = []
  await mount(
    <Combobox
      label="Status"
      options={STATUSES}
      selected={[]}
      onSelect={(value) => picked.push(value)}
    />,
  )
  await press("Enter", { isComposing: true })
  expect(picked).toEqual([])
})

test("a single select closes after picking, a multi select stays open", async () => {
  const { Combobox } = await import("./combobox")
  let closed = 0
  await mount(
    <Combobox
      label="Status"
      options={STATUSES}
      selected={[]}
      onSelect={() => {}}
      onClose={() => closed++}
    />,
  )
  await press("Enter")
  expect(closed).toBe(1)
  await mount(
    <Combobox
      label="Labels"
      multiple
      options={STATUSES}
      selected={["todo"]}
      onSelect={() => {}}
      onClose={() => closed++}
    />,
  )
  expect(container.querySelector('[role="listbox"]')!.getAttribute("aria-multiselectable")).toBe(
    "true",
  )
  expect(container.querySelector('[role="option"][aria-selected="true"]')!.textContent).toBe("Todo")
  await press("Enter")
  expect(closed).toBe(1)
})

test("Escape closes without reaching the page's own shortcuts", async () => {
  const { Combobox } = await import("./combobox")
  let closed = 0
  let reachedDocument = 0
  const onDocumentKeyDown = () => reachedDocument++
  window.document.addEventListener("keydown", onDocumentKeyDown)
  await mount(
    <Combobox
      label="Status"
      options={STATUSES}
      selected={[]}
      onSelect={() => {}}
      onClose={() => closed++}
    />,
  )
  await press("Escape")
  window.document.removeEventListener("keydown", onDocumentKeyDown)
  expect(closed).toBe(1)
  expect(reachedDocument).toBe(0)
})

test("a query that matches no option offers to create it", async () => {
  const { Combobox } = await import("./combobox")
  const created: string[] = []
  await mount(
    <Combobox
      label="Labels"
      multiple
      options={[{ value: "bug", label: "bug" }]}
      selected={[]}
      onSelect={() => {}}
      onCreate={(query) => created.push(query)}
    />,
  )
  await type("design")
  expect(visibleLabels()).toEqual(['Create "design"'])
  await press("Enter")
  expect(created).toEqual(["design"])
  // 既にある名前をそのまま打ったときは、作る候補を出さない
  await type("Bug")
  expect(visibleLabels()).toEqual(["bug"])
})

test("clicking an option selects it", async () => {
  const { Combobox } = await import("./combobox")
  const picked: string[] = []
  await mount(
    <Combobox
      label="Status"
      options={STATUSES}
      selected={[]}
      onSelect={(value) => picked.push(value)}
    />,
  )
  const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')][1]!
  option.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
  await settle()
  expect(picked).toEqual(["todo"])
})
