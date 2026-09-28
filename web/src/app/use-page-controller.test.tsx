import { afterEach, expect, test } from "vitest"
import type { BoardApi } from "../board/board-api"
import { BLANK, type PageData, type SaveInput } from "../board/page-data"
import { SaveRejectedError } from "../board/save-error"
import type { Issue } from "../domain/issue"
import type { PageController } from "./use-page-controller"

const saved: Issue = { ...BLANK, id: "1", title: "t", dueDate: "2026-10-01", priority: "high" }

let container: HTMLElement | undefined
let controller: PageController

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  container = undefined
  document.body.innerHTML = ""
})

test("a value the server rejects is reverted and the promise rejects with the server message", async () => {
  const harness = fakeApi()
  harness.saveQueue.push({
    kind: "reject",
    message: "invalid dueDate: expected YYYY-MM-DD, actual x",
  })
  await mount(page(), harness.api)
  await expect(controller.commitField("dueDate", "x")).rejects.toThrow(
    "invalid dueDate: expected YYYY-MM-DD, actual x",
  )
  await settle()
  expect(controller.state.current?.dueDate).toBe("2026-10-01")
  expect(controller.state.requestError).toBeUndefined()
  expect(controller.state.saveState).toBe("idle")
  expect(controller.state.draftDirty).toBe(false)
})

test("a save that never arrived keeps the draft, and Retry sends every unsaved field at once", async () => {
  const harness = fakeApi()
  harness.saveQueue.push({ kind: "network" })
  await mount(page(), harness.api)
  await controller.commitField("priority", "low")
  await settle()
  expect(controller.state.saveState).toBe("failed")
  expect(controller.state.current?.priority).toBe("low")
  expect(controller.state.draftDirty).toBe(true)
  const loaded = page({ ...saved, priority: "low" })
  harness.saveQueue.push({ kind: "issue", issue: { ...saved, priority: "low" } })
  harness.loadQueue.push(loaded)
  await controller.retrySave()
  await settle()
  expect(harness.saves.at(-1)).toEqual({ id: "1", priority: "low" })
  expect(controller.state.saveState).toBe("saved")
  expect(controller.state.draftDirty).toBe(false)
})

test("a patch the server rejects rejects without a global error, a lost one reports it", async () => {
  const harness = fakeApi()
  harness.saveQueue.push({
    kind: "reject",
    message: "unknown status: expected one of todo, actual x",
  })
  await mount(page(null), harness.api)
  await expect(controller.patchIssue("1", { status: "x" })).rejects.toThrow("unknown status")
  await settle()
  expect(controller.state.requestError).toBeUndefined()
  harness.saveQueue.push({ kind: "network" })
  await controller.patchIssue("1", { status: "done" })
  await settle()
  expect(controller.state.requestError).toBe("Failed to fetch")
})

test("moving an issue on the board never leaves a rejected promise behind", async () => {
  const harness = fakeApi()
  harness.saveQueue.push({
    kind: "reject",
    message: "unknown status: expected one of todo, actual x",
  })
  await mount(page(null), harness.api)
  await controller.moveIssue("1", "x")
  await settle()
  expect(controller.state.requestError).toBe("unknown status: expected one of todo, actual x")
})

test("a link to a missing issue loads the board with the error and drops the id", async () => {
  const harness = fakeApi()
  harness.loadQueue.push({ ...page(null), error: "issue not found: 9" })
  await mount(page(null), harness.api)
  await controller.navigate("http://127.0.0.1/?id=9")
  await settle()
  expect(controller.state.error).toBe("issue not found: 9")
  expect(window.location.search).toBe("")
})

test("only a page load that never arrived is offered a retry", async () => {
  const harness = fakeApi()
  harness.loadQueue.push("network")
  await mount(page(null), harness.api)
  await controller.navigate("http://127.0.0.1/")
  await settle()
  expect(controller.state.requestError).toBe("Failed to fetch")
  expect(controller.state.requestRetryable).toBe(true)
  harness.saveQueue.push({ kind: "network" })
  await controller.patchIssue("1", { status: "done" })
  await settle()
  expect(controller.state.requestRetryable).toBe(false)
})

test("a created issue opens by its number without the new issue parameters in the URL", async () => {
  const harness = fakeApi()
  const draft: Issue = { ...BLANK, title: "新しい issue", labels: ["ui"], assignee: "aovoq" }
  window.history.replaceState(
    null,
    "",
    "/?label=ui&id=new&new_status=todo&new_parent=3&new_label=ui&new_assignee=me",
  )
  await mount(page(draft), harness.api)
  const created = { ...draft, id: "9" }
  harness.saveQueue.push({ kind: "issue", issue: created })
  harness.loadQueue.push(page(created))
  await controller.saveCurrent()
  await settle()
  expect(window.location.search).toBe("?label=ui&id=9")
  window.history.replaceState(null, "", "/")
})

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
    viewer: "aovoq",
    now: "2026-09-28T12:00:00.000Z",
    basePath: "/p/app",
  }
}

type SaveReply =
  | { kind: "issue"; issue: Issue }
  | { kind: "reject"; message: string }
  | { kind: "network" }

function fakeApi(): {
  api: BoardApi
  saves: Partial<SaveInput>[]
  saveQueue: SaveReply[]
  loadQueue: Array<PageData | "network">
} {
  const saves: Partial<SaveInput>[] = []
  const saveQueue: SaveReply[] = []
  const loadQueue: Array<PageData | "network"> = []
  const api: BoardApi = {
    loadPage: async (href) => {
      const next = loadQueue.shift()
      if (next === undefined) throw new Error(`unexpected load: ${href}`)
      if (next === "network") throw new TypeError("Failed to fetch")
      return next
    },
    saveIssue: async (input) => {
      saves.push(input)
      const next = saveQueue.shift()
      if (next === undefined) throw new Error("unexpected save")
      if (next.kind === "network") throw new TypeError("Failed to fetch")
      if (next.kind === "reject") throw new SaveRejectedError(next.message)
      return next.issue
    },
    loadWorkspaces: async () => [],
    subscribe: async () => {},
  }
  return { api, saves, saveQueue, loadQueue }
}

async function mount(initial: PageData, api: BoardApi): Promise<void> {
  const { render } = await import("preact")
  const { usePageController } = await import("./use-page-controller")
  function Probe() {
    controller = usePageController(initial, { api })
    return null
  }
  container = document.createElement("div")
  document.body.appendChild(container)
  render(<Probe />, container)
  await settle()
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
