import { afterEach, expect, test } from "vitest"
import { renderToString } from "preact-render-to-string"
import { installTestDom } from "../test-dom"
import { IssueActionsContext, type IssueActions } from "./context-menu/issue-actions"
import type { PageFilters } from "./view-model"
import { Header } from "./header"

// Display の面と、スマホ幅の検索欄を開く操作は、実際の DOM に押す操作を送らないと確かめられないので happy-dom を使う
const window = installTestDom()

let container: HTMLElement | undefined

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  container = undefined
  window.document.body.innerHTML = ""
})

function header(filters: PageFilters = { basePath: "/p/app" }) {
  return (
    <Header
      filters={filters}
      count={4}
      awaitingQuestionCount={2}
      labelColors={new Map([["ui", "#123456"]])}
      onSearch={() => {}}
      onOpenSidebar={() => {}}
    />
  )
}

async function mount(filters?: PageFilters): Promise<HTMLElement> {
  const { render } = await import("preact")
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(header(filters), container)
  await settle()
  return container
}

async function settle(): Promise<void> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test("the Display popover offers grouping, ordering, and completed issues as links that keep the other filters", async () => {
  const root = await mount({ basePath: "/p/app", label: "ui", group: "priority" })
  expect(root.querySelector("[data-popover]")).toBeNull()
  const trigger = root.querySelector<HTMLButtonElement>("#display-menu")!
  expect(trigger.getAttribute("aria-expanded")).toBe("false")
  trigger.click()
  await settle()
  expect(trigger.getAttribute("aria-expanded")).toBe("true")
  const panel = root.querySelector("[data-popover]")!
  const hrefs = [...panel.querySelectorAll("a")].map((link) => link.getAttribute("href"))
  expect(hrefs).toContain("/p/app/?label=ui")
  expect(hrefs).toContain("/p/app/?label=ui&group=label")
  expect(hrefs).toContain("/p/app/?label=ui&sort=due&group=priority")
  expect(hrefs).toContain("/p/app/?label=ui&group=priority&completed=all")
  const current = panel.querySelector('a[aria-current="page"]')!
  expect(current.getAttribute("href")).toBe("/p/app/?label=ui&group=priority")
})

test("the Display popover leaves out the completed option in the done column, where the server shows all of them", async () => {
  const root = await mount({ basePath: "/p/app", status: "done" })
  root.querySelector<HTMLButtonElement>("#display-menu")!.click()
  await settle()
  expect(root.querySelector("[data-popover]")!.textContent).not.toContain("Completed issues")
})

test("on phones the search icon expands a full-width search field and Escape folds it back", async () => {
  const root = await mount()
  const form = root.querySelector<HTMLFormElement>("form[role=search]")!
  expect(form.getAttribute("data-expanded")).toBeNull()
  root.querySelector<HTMLButtonElement>("#search-open")!.click()
  await settle()
  expect(form.getAttribute("data-expanded")).toBe("")
  const input = root.querySelector<HTMLInputElement>("#q")!
  expect((window.document.activeElement as unknown) === input).toBe(true)
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as never,
  )
  await settle()
  expect(form.getAttribute("data-expanded")).toBeNull()
})

test("the search field is 16px on phones so iOS does not zoom into it", () => {
  const input = renderToString(header()).match(/<input[^>]*id="q"[^>]*>/)![0]
  expect(input).toContain(" text-base ")
  expect(input).toContain(" sm:text-body ")
})

test("phones get a dashboard entry in the header with the count of questions awaiting an answer", () => {
  const html = renderToString(header())
  expect(html).toMatch(
    /id="mobile-dashboard-link"[^>]*href="\/p\/app\/dashboard"[\s\S]*?Dashboard[\s\S]*?>2</,
  )
})

test("the header clears the notch with the safe area padding", () => {
  expect(renderToString(header())).toContain("pt-safe")
})

test("the view switch names its items and marks the current one", () => {
  const html = renderToString(header({ basePath: "/p/app", view: "board" }))
  expect(html).toMatch(/aria-label="Board" aria-current="page"/)
  expect(html).toMatch(/aria-label="List"(?! aria-current)/)
})

test("the new issue button carries the label and assignee filters", () => {
  const html = renderToString(header({ basePath: "/p/app", label: "ui", assignee: "me" }))
  expect(html).toContain("new_label=ui&amp;new_assignee=me")
})

test("the search form carries only the display options that differ from the defaults", () => {
  const html = renderToString(
    header({
      basePath: "/p/app",
      awaiting: true,
      sort: "priority",
      group: "label",
      completed: "recent",
    }),
  )
  expect(html).toContain('name="awaiting" value="1"')
  expect(html).toContain('name="group" value="label"')
  expect(html).not.toContain('name="sort"')
  expect(html).not.toContain('name="completed"')
})

test("the command menu button opens the palette, so phones without a keyboard can reach it", async () => {
  const opened: string[] = []
  const actions: IssueActions = {
    openIssueMenuAt: () => {},
    openPropertyPicker: () => {},
    openCommandPalette: () => opened.push("palette"),
    bulkSelection: [],
    toggleBulkSelection: () => {},
    retrySave: async () => {},
    returnedDrafts: {},
  }
  const { render } = await import("preact")
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(
    <IssueActionsContext.Provider value={actions}>{header()}</IssueActionsContext.Provider>,
    container,
  )
  await settle()
  const button = container.querySelector<HTMLButtonElement>("#command-palette-open")!
  expect(button.getAttribute("aria-label")).toBe("Command menu")
  // 広い画面ではキーボードの近道も添える。スマホ幅では帯が狭いのでアイコンだけにする
  expect(button.textContent).toContain("⌘K")
  button.click()
  expect(opened).toEqual(["palette"])
})
