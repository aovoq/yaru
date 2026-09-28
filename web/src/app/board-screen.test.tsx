import { afterEach, expect, test } from "vitest"
import { renderToString } from "preact-render-to-string"
import type { BoardApi } from "../board/board-api"
import { BLANK, type PageData } from "../board/page-data"
import type { Issue } from "../domain/issue"
import { BoardScreen } from "./board-screen"

let container: HTMLElement | undefined

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  container = undefined
  document.body.innerHTML = ""
})

const one: Issue = { ...BLANK, id: "1", title: "one", status: "todo" }
const two: Issue = { ...BLANK, id: "2", title: "two", status: "todo" }

test("an open issue makes only the board inert and keeps the issue after the sidebar", () => {
  const html = renderToString(
    <BoardScreen slug="app" query={query()} fragment={null} api={idleApi()} initialPage={board(one)} />,
  )
  const root = document.createElement("div")
  root.innerHTML = html
  const shell = root.querySelector("[data-board-shell]")!
  expect(shell.hasAttribute("inert")).toBe(true)
  expect(shell.querySelector("#board")).not.toBeNull()
  expect(root.querySelector("#sidebar")!.closest("[inert]")).toBeNull()
  const sidebar = root.querySelector("#sidebar")!
  const dialog = root.querySelector("#issue-view")!
  expect(Boolean(sidebar.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
    true,
  )
})

test("the board is not inert while no issue is open", () => {
  const html = renderToString(
    <BoardScreen slug="app" query={query()} fragment={null} api={idleApi()} initialPage={board(null)} />,
  )
  const root = document.createElement("div")
  root.innerHTML = html
  expect(root.querySelector("[data-board-shell]")!.hasAttribute("inert")).toBe(false)
  expect(root.textContent).toContain("one")
  expect(root.textContent).toContain("two")
})

test("j selects the next row in the order on the board", async () => {
  const root = await mount(board(null))
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }))
  await settle()
  expect(root.querySelector('[data-id="1"]')?.getAttribute("aria-selected")).toBe("true")
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }))
  await settle()
  expect(root.querySelector('[data-id="2"]')?.getAttribute("aria-selected")).toBe("true")
})

test("a right click on a row opens the issue menu", async () => {
  const root = await mount(board(null))
  const row = root.querySelector<HTMLElement>('[data-id="1"]')!
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }))
  await settle()
  expect(root.textContent).toContain("Open issue")
})

test("leaving a new issue that already has a title asks before discarding it", async () => {
  const root = await mount(board({ ...BLANK, title: "書きかけ" }))
  const dashboard = [...root.querySelectorAll<HTMLAnchorElement>("#sidebar a")].find(
    (link) => link.getAttribute("href") === "/p/app/dashboard",
  )!
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  dashboard.dispatchEvent(click)
  await settle()
  expect(click.defaultPrevented).toBe(true)
  expect(root.textContent).toContain("Discard changes?")
})

function query() {
  return {
    query: null,
    id: null,
    status: null,
    assignee: null,
    label: null,
    awaiting: null,
    sort: null,
    group: null,
    completed: null,
    view: null,
    newStatus: null,
    newParent: null,
    newLabel: null,
    newAssignee: null,
    error: null,
    comment: null,
    questionId: null,
    answer: null,
  }
}

function board(current: Issue | null): PageData {
  return {
    issues: [one, two],
    all: [one, two],
    query: "",
    current,
    comments: [],
    events: [],
    commits: [],
    awaiting: false,
    awaitingByIssue: {},
    display: { sort: "priority", group: "status", completed: "recent" },
    view: "list",
    basePath: "/p/app",
    awaitingQuestionCount: 0,
    viewer: "aovoq",
    now: "2026-09-28T12:00:00.000Z",
  }
}

function idleApi(): BoardApi {
  return {
    loadPage: async () => {
      throw new Error("unused loadPage")
    },
    saveIssue: async () => {
      throw new Error("unused saveIssue")
    },
    loadWorkspaces: async () => [],
    subscribe: async () => {},
  }
}

async function mount(initial: PageData): Promise<HTMLElement> {
  const { render } = await import("preact")
  container = document.createElement("div")
  document.body.appendChild(container)
  render(
    <BoardScreen slug="app" query={query()} fragment={null} api={idleApi()} initialPage={initial} />,
    container,
  )
  await settle()
  return container
}

async function settle(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
