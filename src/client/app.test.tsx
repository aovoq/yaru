import { afterEach, expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { BLANK } from "../page"
import type { Issue } from "../store"
import { installTestDom } from "../test-dom"
import type { BoardPageProps } from "./app"

// サイドバーと板の本体のどちらを inert にするか、リンクを押したときに変更を捨てる確認が出るかは、
// 実際の DOM に描いて押さないと確かめられないので happy-dom を使う
const window = installTestDom()
const globals = globalThis as Record<string, unknown>

// 板は読み込み直しの知らせを EventSource で受ける。happy-dom には無いので、何も届かないものに差し替える
class SilentEventSource {
  onmessage: (() => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  close(): void {}
}
globals.EventSource = SilentEventSource

let container: HTMLElement | undefined

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  container = undefined
  window.document.body.innerHTML = ""
})

const topic: Issue = { ...BLANK, id: "1", title: "topic", status: "todo" }

function props(current: Issue | null): BoardPageProps {
  return {
    issues: [topic],
    all: [topic],
    query: "",
    current,
    comments: [],
    events: [],
    commits: [],
    awaiting: false,
    awaitingByIssue: {},
    display: { sort: "priority", group: "status", completed: "recent" },
    basePath: "/p/app",
    viewer: "aovoq",
  }
}

async function mount(current: Issue | null): Promise<HTMLElement> {
  const { render } = await import("preact")
  const { BoardPage } = await import("./app")
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(<BoardPage {...props(current)} />, container)
  await settle()
  return container
}

async function settle(): Promise<void> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test("an open issue makes only the board inert, so the sidebar stays usable beside it", async () => {
  const { BoardPage } = await import("./app")
  const html = renderToString(<BoardPage {...props(topic)} />)
  const root = window.document.createElement("div")
  root.innerHTML = html
  const shell = root.querySelector("[data-board-shell]")!
  expect(shell.hasAttribute("inert")).toBe(true)
  expect(shell.querySelector("#board")).not.toBeNull()
  expect(root.querySelector("#sidebar")!.closest("[inert]")).toBeNull()
  // focus の順はサイドバー → issue 画面になるよう、issue 画面はサイドバーより後ろに置く
  const sidebar = root.querySelector("#sidebar")!
  const dialog = root.querySelector("#issue-view")!
  expect(
    Boolean(sidebar.compareDocumentPosition(dialog) & window.Node.DOCUMENT_POSITION_FOLLOWING),
  ).toBe(true)
})

test("the board is not inert while no issue is open", async () => {
  const { BoardPage } = await import("./app")
  const root = window.document.createElement("div")
  root.innerHTML = renderToString(<BoardPage {...props(null)} />)
  expect(root.querySelector("[data-board-shell]")!.hasAttribute("inert")).toBe(false)
})

test("leaving a new issue with a typed title for the dashboard asks before discarding it", async () => {
  const root = await mount({ ...BLANK })
  const title = root.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!
  title.value = "書きかけ"
  title.dispatchEvent(new window.Event("input", { bubbles: true }) as never)
  await settle()
  const dashboard = [...root.querySelectorAll<HTMLAnchorElement>("#sidebar a")].find(
    (link) => link.getAttribute("href") === "/p/app/dashboard",
  )!
  const click = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  dashboard.dispatchEvent(click as never)
  await settle()
  expect(click.defaultPrevented).toBe(true)
  expect(root.textContent).toContain("Discard changes?")
})
