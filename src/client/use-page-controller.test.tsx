import { afterEach, beforeEach, expect, test } from "bun:test"
import { BLANK, type PageData } from "../page"
import type { Issue } from "../store"
import { installTestDom } from "../test-dom"
import type { PageController } from "./use-page-controller"

// 保存の失敗の分け方 (値を受け付けなかったのか、届かなかったのか) は fetch の結果で決まるので、fetch を差し替えて確かめる
const window = installTestDom()

type Reply = { status: number; body: unknown } | "network"
let replies: Reply[]
let requests: { url: string; body: unknown }[]
let controller: PageController
let container: HTMLElement
const globals = globalThis as Record<string, unknown>
const originalFetch = globals.fetch

class FakeEventSource {
  onmessage: (() => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  close() {}
}

beforeEach(() => {
  replies = []
  requests = []
  globals.EventSource = FakeEventSource
  globals.fetch = async (input: string, init?: { body?: string }) => {
    requests.push({ url: String(input), body: init?.body ? JSON.parse(init.body) : undefined })
    const reply = replies.shift()
    if (reply === undefined) throw new Error(`unexpected request: ${input}`)
    if (reply === "network") throw new TypeError("Failed to fetch")
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    })
  }
})

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  globals.fetch = originalFetch
  window.document.body.innerHTML = ""
})

const saved: Issue = { ...BLANK, id: "1", title: "t", dueDate: "2026-10-01", priority: "high" }

function page(current: Issue | null = saved): PageData {
  return {
    issues: [saved],
    all: [saved],
    query: "",
    current,
    comments: [],
    view: "list",
    events: [],
    commits: [],
    awaiting: false,
    awaitingByIssue: {},
    display: { sort: "priority", group: "status", completed: "recent" },
  }
}

async function mount(initial: PageData): Promise<void> {
  const { render } = await import("preact")
  const { usePageController } = await import("./use-page-controller")
  function Probe() {
    controller = usePageController(initial)
    return null
  }
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(<Probe />, container)
  await settle()
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test("a value the server rejects is reverted and the promise rejects with the server message", async () => {
  await mount(page())
  replies.push({ status: 400, body: { error: "invalid dueDate: expected YYYY-MM-DD, actual x" } })
  const result = controller.commitField("dueDate", "x")
  await expect(result).rejects.toThrow("invalid dueDate: expected YYYY-MM-DD, actual x")
  await settle()
  expect(controller.state.current?.dueDate).toBe("2026-10-01")
  expect(controller.state.requestError).toBeUndefined()
  expect(controller.state.saveState).toBe("idle")
  expect(controller.state.draftDirty).toBe(false)
})

test("a save that never arrived keeps the draft, and Retry sends every unsaved field at once", async () => {
  await mount(page())
  replies.push("network")
  await controller.commitField("priority", "low")
  await settle()
  expect(controller.state.saveState).toBe("failed")
  expect(controller.state.current?.priority).toBe("low")
  expect(controller.state.draftDirty).toBe(true)
  const loaded = { ...page(), current: { ...saved, priority: "low" as const } }
  replies.push({ status: 200, body: { ...saved, priority: "low" } }, { status: 200, body: loaded })
  await controller.retrySave()
  await settle()
  expect(requests.at(-2)).toEqual({ url: "/api/issues", body: { id: "1", priority: "low" } })
  expect(controller.state.saveState).toBe("saved")
  expect(controller.state.draftDirty).toBe(false)
})

test("a patch the server rejects rejects without a global error, a lost one reports it", async () => {
  await mount(page(null))
  replies.push({ status: 400, body: { error: "unknown status: expected one of todo, actual x" } })
  await expect(controller.patchIssue("1", { status: "x" })).rejects.toThrow("unknown status")
  await settle()
  expect(controller.state.requestError).toBeUndefined()
  replies.push("network")
  await controller.patchIssue("1", { status: "done" })
  await settle()
  expect(controller.state.requestError).toBe("Failed to fetch")
})

test("moving an issue on the board never leaves a rejected promise behind", async () => {
  await mount(page(null))
  replies.push({ status: 400, body: { error: "unknown status: expected one of todo, actual x" } })
  await controller.moveIssue("1", "x")
  await settle()
  expect(controller.state.requestError).toBe("unknown status: expected one of todo, actual x")
})

test("a link to a missing issue loads the board with the error and drops the id", async () => {
  await mount(page(null))
  replies.push({ status: 404, body: { ...page(null), error: "issue not found: 9" } })
  await controller.navigate("http://127.0.0.1/?id=9")
  await settle()
  expect(controller.state.error).toBe("issue not found: 9")
  expect(window.location.search).toBe("")
})

test("only a page load that never arrived is offered a retry", async () => {
  await mount(page(null))
  replies.push("network")
  await controller.navigate("http://127.0.0.1/")
  await settle()
  expect(controller.state.requestError).toBe("Failed to fetch")
  expect(controller.state.requestRetryable).toBe(true)
  replies.push("network")
  await controller.patchIssue("1", { status: "done" })
  await settle()
  expect(controller.state.requestRetryable).toBe(false)
})
