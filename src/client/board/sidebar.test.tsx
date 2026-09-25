import { afterEach, expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { installTestDom } from "../../test-dom"
import { BLANK } from "../../page"
import type { Issue } from "../../store"
import { Sidebar } from "./sidebar"

// 切り替えの面を開いて /api/inbox を読むところは、実際の DOM に押す操作を送らないと確かめられないので happy-dom を使う
const window = installTestDom()

const ISSUES: Issue[] = [
  { ...BLANK, id: "1", title: "one", status: "todo", labels: ["ui"], assignee: "me" },
  { ...BLANK, id: "2", title: "two", status: "done", labels: [] },
]

const COLORS = new Map([["ui", "#123456"]])

function sidebar(extra: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return renderToString(
    <Sidebar
      all={ISSUES}
      filters={{ basePath: "/p/yaru-demo" }}
      awaitingQuestionCount={3}
      awaitingByIssue={{ "1": { count: 2, expired: 0, soonestAnswerBy: null } }}
      labelColors={COLORS}
      {...extra}
    />,
  )
}

const originalFetch = globalThis.fetch
let container: HTMLElement | undefined

afterEach(async () => {
  globalThis.fetch = originalFetch
  const { render } = await import("preact")
  if (container) render(null, container)
  container = undefined
  window.document.body.innerHTML = ""
})

test("the sidebar header names the workspace and keeps the logo link to the list of workspaces", () => {
  const html = sidebar()
  expect(html).toContain("yaru-demo")
  expect(html).toContain('href="/"')
})

test("the sidebar offers an awaiting answer filter counting the issues with questions to answer", () => {
  const html = sidebar()
  expect(html).toMatch(/href="\/p\/yaru-demo\/\?awaiting=1"[\s\S]*?Awaiting answer[\s\S]*?>1</)
})

test("the active filter is announced as the current page", () => {
  const html = sidebar({ filters: { basePath: "/p/yaru-demo", awaiting: true } })
  expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*?Awaiting answer/)
  expect(html).not.toMatch(/aria-current="page"[^>]*>[\s\S]{0,400}All issues/)
})

test("inside the dashboard the dashboard item is the active one, not all issues", () => {
  const html = sidebar({ active: "dashboard" })
  expect(html).toContain('href="/p/yaru-demo/dashboard" aria-current="page"')
  expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1)
})

test("labels in the sidebar use the workspace label colors", () => {
  expect(sidebar()).toContain("background: #123456")
})

test("the keyboard hint shows J and K as two keys", () => {
  expect(sidebar()).toContain("<kbd")
  expect(sidebar()).toMatch(/>J<\/kbd>[\s\S]{0,40}<kbd[^>]*>K<\/kbd>/)
})

test("icons next to their own names are hidden from screen readers", () => {
  const html = sidebar()
  expect(html).not.toContain('role="img" aria-label="Todo"')
})

test("the sidebar renders without the collapse and resize handlers, as the dashboard renders it on the server", () => {
  expect(sidebar({ sidebar: undefined })).toContain('id="sidebar-resizer"')
})

test("the workspace switcher lists the workspaces with their awaiting counts when opened", async () => {
  const requests: string[] = []
  globalThis.fetch = (async (input: string) => {
    requests.push(String(input))
    return new Response(
      JSON.stringify({
        groups: {},
        workspaces: [
          { slug: "yaru-demo", basePath: "/p/yaru-demo", awaiting: 3 },
          { slug: "other", basePath: "/p/other", awaiting: 0 },
        ],
      }),
    )
  }) as typeof fetch
  const { render } = await import("preact")
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(
    <Sidebar
      all={ISSUES}
      filters={{ basePath: "/p/yaru-demo" }}
      awaitingQuestionCount={3}
      awaitingByIssue={{}}
      labelColors={COLORS}
    />,
    container,
  )
  expect(requests).toEqual([])
  const trigger = container!.querySelector<HTMLButtonElement>("#workspace-switcher")!
  trigger.click()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(requests).toEqual(["/api/inbox"])
  const links = [...container!.querySelectorAll<HTMLAnchorElement>("[data-workspace]")]
  expect(links.map((link) => [link.getAttribute("href"), link.textContent])).toEqual([
    ["/p/yaru-demo/", "yaru-demo3"],
    ["/p/other/", "other0"],
  ])
  expect(links[0]!.getAttribute("aria-current")).toBe("page")
})

test("a single workspace has no switcher since there is nothing to switch to", () => {
  const html = sidebar({ filters: { basePath: "" } })
  expect(html).toContain(">yaru<")
  expect(html).not.toContain('id="workspace-switcher"')
})
