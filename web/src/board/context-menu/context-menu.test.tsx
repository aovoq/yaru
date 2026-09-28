import { afterEach, expect, test } from "vitest"
import type { ComponentChild } from "preact"
import { BLANK } from "../page-data"
import type { Issue } from "../../domain/issue"
import { installTestDom } from "../../test-dom"
import { issueMenu, type MenuAction } from "../issue-menu"

// メニューのキーボード操作と focus の戻り先は、実際の DOM にキーを送らないと確かめられないので happy-dom を使う
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

async function settle(): Promise<void> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function press(target: Element, key: string): Promise<void> {
  target.dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true }) as unknown as Event,
  )
  await settle()
}

const issue: Issue = { ...BLANK, id: "7", title: "t", status: "todo" }

async function openMenu(items = issueMenu(issue, [issue], options())) {
  const { ContextMenu } = await import("./context-menu")
  const row = window.document.createElement("a")
  row.setAttribute("href", "#")
  window.document.body.appendChild(row)
  const actions: MenuAction[] = []
  let closed = 0
  await mount(
    <ContextMenu
      menu={{ items, x: 0, y: 0, returnFocus: row as unknown as HTMLElement }}
      onAction={(action) => actions.push(action)}
      onClose={() => closed++}
    />,
  )
  return { row, actions, closed: () => closed }
}

function options() {
  return { now: new Date(2026, 8, 25), boardUrl: "http://host/p/app/" }
}

function panels(): HTMLElement[] {
  return [...window.document.querySelectorAll('[role="menu"]')] as unknown as HTMLElement[]
}

function activeLabel(panel: HTMLElement): string | undefined {
  const id = panel.getAttribute("aria-activedescendant")
  return id ? (window.document.getElementById(id)?.textContent ?? undefined) : undefined
}

test("the panel tells assistive technology which item is active", async () => {
  await openMenu()
  const [panel] = panels()
  expect(panel!.getAttribute("aria-activedescendant")).toBeNull()
  await press(panel!, "ArrowDown")
  expect(activeLabel(panel!)).toBe("Status")
})

test("opening a submenu with the right arrow selects its first item", async () => {
  await openMenu()
  const [panel] = panels()
  await press(panel!, "ArrowDown")
  await press(panel!, "ArrowRight")
  const submenu = panels()[1]!
  expect(submenu.getAttribute("aria-label")).toBe("Status")
  expect(activeLabel(submenu)).toBe("Backlog")
})

test("Escape closes the menu and returns focus to the row it was opened from", async () => {
  const { row, closed } = await openMenu()
  const [panel] = panels()
  await press(panel!, "Escape")
  expect(closed()).toBe(1)
  expect((window.document.activeElement as unknown) === row).toBe(true)
})

test("choosing an item returns focus to the row and passes the action", async () => {
  const { row, actions } = await openMenu()
  const copy = [...window.document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === "Copy ID",
  ) as unknown as HTMLElement
  copy.click()
  await settle()
  expect(actions).toEqual([{ type: "copy", text: "#7", notice: "Copied ID #7" }])
  expect((window.document.activeElement as unknown) === row).toBe(true)
})

test("a disabled placeholder is announced as disabled and does nothing", async () => {
  const { actions } = await openMenu([{ kind: "action", label: "No labels yet", disabled: true }])
  const [panel] = panels()
  const item = panel!.querySelector('[role="menuitem"]') as unknown as HTMLElement
  expect(item.getAttribute("aria-disabled")).toBe("true")
  item.click()
  await press(panel!, "ArrowDown")
  await press(panel!, "Enter")
  expect(actions).toEqual([])
  expect(panel!.getAttribute("aria-activedescendant")).toBeNull()
})
