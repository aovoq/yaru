import { afterEach, expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { BLANK } from "../../page"
import type { Issue } from "../../store"
import { installTestDom } from "../../test-dom"
import { IssueActionsContext, type IssueActions } from "../context-menu/issue-actions"
import { IssueRow } from "./issue-row"

// まとめて選ぶ印を押したときに行を開かず選ぶだけかは、実際の DOM に押す操作を送らないと確かめられないので happy-dom を使う
const window = installTestDom()

let container: HTMLElement | undefined

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  container = undefined
  window.document.body.innerHTML = ""
})

const actions: IssueActions = {
  openIssueMenuAt: () => {},
  openPropertyPicker: () => {},
  bulkSelection: [],
  toggleBulkSelection: () => {},
  retrySave: async () => {},
  returnedDrafts: {},
}

const NOW = new Date("2026-09-26T03:00:00.000Z")

function issue(fields: Partial<Issue> = {}): Issue {
  return { ...BLANK, id: "73", title: "板を直す", status: "todo", ...fields }
}

function rowNode(
  fields: Partial<Issue> = {},
  extra: Partial<Parameters<typeof IssueRow>[0]> = {},
  issueActions: Partial<IssueActions> = {},
) {
  return (
    <IssueActionsContext.Provider value={{ ...actions, ...issueActions }}>
      <IssueRow
        issue={issue(fields)}
        filters={{ basePath: "/p/app" }}
        selected={false}
        labelColors={new Map([["ui", "#123456"]])}
        now={NOW}
        {...extra}
      />
    </IssueActionsContext.Provider>
  )
}

function row(
  fields: Partial<Issue> = {},
  extra: Partial<Parameters<typeof IssueRow>[0]> = {},
  issueActions: Partial<IssueActions> = {},
) {
  return renderToString(rowNode(fields, extra, issueActions))
}

function parse(html: string): HTMLElement {
  const root = window.document.createElement("div")
  root.innerHTML = html
  return root as unknown as HTMLElement
}

test("a list row shows the status icon and the issue number in the shared #73 form", () => {
  const html = row({ status: "in_progress" })
  expect(html).toContain('role="img" aria-label="In Progress"')
  expect(html).toContain("#73")
})

test("a selected list row marks itself with aria-selected so the primary bar and surface apply", () => {
  expect(row({}, { selected: true })).toContain('aria-selected="true"')
  expect(row()).not.toContain('aria-selected="true"')
})

test("a finished issue past its due date is not shown as overdue", () => {
  expect(row({ dueDate: "2026-09-01", status: "done" })).not.toContain("Overdue")
  expect(row({ dueDate: "2026-09-01", status: "todo" })).toContain("Overdue")
})

test("labels use the workspace colors rather than the hash of the name", () => {
  expect(row({ labels: ["ui"] })).toContain("background: #123456")
})

test("the phone layout gets a second line with the due date and the label the issue is grouped under", () => {
  const html = row({ labels: ["ui", "bug"], dueDate: "2026-10-20" })
  expect(html).toMatch(/data-row-meta[^>]*sm:hidden[\s\S]*Oct 20[\s\S]*bug/)
})

test("an issue with questions awaiting an answer shows the time left", () => {
  const html = row(
    {},
    { awaiting: { count: 1, expired: 0, soonestAnswerBy: "2026-09-26T05:00:00.000Z" } },
  )
  expect(html).toContain("data-awaiting")
  expect(html).toContain("next due in 2h")
})

test("an issue that is in progress but has not moved for a while is marked stale", () => {
  expect(row({ status: "in_progress", stale: true })).toContain("Stale")
  expect(row({ status: "in_progress", stale: false })).not.toContain("Stale")
})

test("a row in the bulk selection is tinted and its checkbox is checked", () => {
  const root = parse(row({}, {}, { bulkSelection: ["73"] }))
  const link = root.querySelector("a[data-id='73']")!
  expect(link.hasAttribute("data-bulk-selected")).toBe(true)
  const checkbox = root.querySelector("[role=checkbox]")!
  expect(checkbox.getAttribute("aria-checked")).toBe("true")
  expect(checkbox.getAttribute("aria-label")).toBe("Select #73")
  // 印は行のリンクの外に置く。リンクの中に押せるものを入れ子にすると、押したときに行も開いてしまう
  expect(checkbox.closest("a")).toBeNull()
})

test("a row outside the bulk selection is not tinted", () => {
  const root = parse(row({}, {}, { bulkSelection: ["8"] }))
  expect(root.querySelector("a[data-id='73']")!.hasAttribute("data-bulk-selected")).toBe(false)
  expect(root.querySelector("[role=checkbox]")!.getAttribute("aria-checked")).toBe("false")
})

test("the checkbox shows on every row while anything is selected, and only on hover otherwise", () => {
  const selecting = parse(row({}, {}, { bulkSelection: ["8"] })).querySelector("[role=checkbox]")!
  expect(selecting.getAttribute("class")).toContain("opacity-100")
  expect(selecting.getAttribute("class")).not.toContain("opacity-0")
  const idle = parse(row()).querySelector("[role=checkbox]")!
  expect(idle.getAttribute("class")).toContain("opacity-0")
  // 指で触る端末には hover が無いので、いつも出す
  expect(idle.getAttribute("class")).toContain("[@media(hover:none)]:opacity-100")
})

test("pressing the checkbox toggles the selection without opening the issue", async () => {
  const toggled: string[] = []
  const { render } = await import("preact")
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(rowNode({}, {}, { toggleBulkSelection: (issueId) => toggled.push(issueId) }), container)
  const click = new window.MouseEvent("click", { bubbles: true, cancelable: true })
  container.querySelector("[role=checkbox]")!.dispatchEvent(click as never)
  expect(toggled).toEqual(["73"])
  expect(click.defaultPrevented).toBe(true)
})
