import { afterEach, expect, test } from "vitest"
import type { ComponentChild } from "preact"
import { installTestDom } from "../test-dom"
import { CopySheet } from "./copy-sheet"
import type { TerminalCopyClient, TerminalPane } from "./terminal-logic"

const testWindow = installTestDom()
let container: HTMLElement

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  testWindow.document.body.innerHTML = ""
})

async function mount(node: ComponentChild): Promise<void> {
  const { render } = await import("preact")
  container = testWindow.document.createElement("div") as unknown as HTMLElement
  testWindow.document.body.appendChild(container as never)
  render(node, container)
  await settle()
}

async function settle(): Promise<void> {
  await new Promise((resolve) => testWindow.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label)
  if (!found) throw new Error(`missing button ${label}`)
  return found as HTMLButtonElement
}

test("the sheet selects the focused pane and copies cleaned text", async () => {
  const panes: TerminalPane[] = [
    { paneId: "shell", label: "shell", agent: "", current: false },
    { paneId: "focus", label: "here", agent: "grok", current: true },
  ]
  const reads: string[] = []
  let resolveList: (value: TerminalPane[]) => void = () => {}
  const client: TerminalCopyClient = {
    listPanes: () =>
      new Promise((resolve) => {
        resolveList = resolve
      }),
    readPane: (paneId) => {
      reads.push(paneId)
      return Promise.resolve(paneId === "focus" ? "hello  \n\n" : "other")
    },
  }
  const copied: string[] = []
  await mount(
    <CopySheet
      client={client}
      onClose={() => {}}
      copy={async (text) => {
        copied.push(text)
        return true
      }}
    />,
  )
  expect(container.textContent).toContain("読み込み中…")
  resolveList(panes)
  await settle()
  await settle()
  expect(reads[0]).toBe("focus")
  expect(container.querySelector("pre")?.textContent).toBe("hello")
  expect(button("here").getAttribute("aria-pressed")).toBe("true")
  button("全部コピー").click()
  await settle()
  expect(copied).toEqual(["hello"])
  expect(container.textContent).toContain("コピーしました")
})

test("a failed pane list shows the error and does not offer copy", async () => {
  const client: TerminalCopyClient = {
    listPanes: async () => {
      throw new Error("terminal panes are unavailable: expected a pane list, actual none")
    },
    readPane: async () => "",
  }
  await mount(<CopySheet client={client} onClose={() => {}} />)
  await settle()
  expect(container.textContent).toContain(
    "terminal panes are unavailable: expected a pane list, actual none",
  )
  expect(button("全部コピー").disabled).toBe(true)
})

test("choosing another pane reads that pane", async () => {
  const reads: string[] = []
  const client: TerminalCopyClient = {
    listPanes: async () => [
      { paneId: "one", label: "one", agent: "grok", current: true },
      { paneId: "two", label: "two", agent: "", current: false },
    ],
    readPane: async (paneId) => {
      reads.push(paneId)
      return paneId
    },
  }
  await mount(<CopySheet client={client} onClose={() => {}} />)
  await settle()
  button("two").click()
  await settle()
  await settle()
  expect(reads).toEqual(["one", "two"])
  expect(container.querySelector("pre")?.textContent).toBe("two")
})
