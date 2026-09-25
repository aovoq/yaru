import { afterEach, expect, test } from "bun:test"
import type { ComponentChild } from "preact"
import { renderToString } from "preact-render-to-string"
import { installTestDom } from "../test-dom"
import { BLANK } from "../page"
import type { Question } from "../questions"
import type { Issue } from "../store"
import { IssueActionsContext, type IssueActions } from "./context-menu/issue-actions"
import type { IssueViewProps } from "./issue-view"
import type { DraftField } from "./state"

// 描き直しで DOM がどう使い回されるか、focus がどこへ動くかは、実際の DOM に描かないと確かめられないので happy-dom を使う
const window = installTestDom()

let container: HTMLElement | undefined
const originalFetch = globalThis.fetch

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  container = undefined
  window.document.body.innerHTML = ""
  globalThis.fetch = originalFetch
  setPointer(true)
})

// 押して編集に移るかは指 (coarse) とマウス (fine) で変えるので、テストごとにどちらかを決める
function setPointer(fine: boolean): void {
  ;(window as unknown as { matchMedia: (query: string) => { matches: boolean } }).matchMedia = (
    query: string,
  ) => ({ matches: fine && query.includes("pointer: fine") })
}
setPointer(true)

function question(id: string, title: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    title,
    status: "open",
    issue: "1",
    priority: null,
    defaultAction: null,
    answerBy: null,
    author: "agent",
    answer: null,
    answeredBy: null,
    answeredAt: null,
    canceledAt: null,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    body: "",
    options: [],
    session: null,
    worktree: null,
    branch: null,
    acknowledgedAt: null,
    notifiedExpiringAt: null,
    ...overrides,
  }
}

const topic: Issue = {
  ...BLANK,
  id: "1",
  title: "topic",
  body: "- [ ] first\n- [ ] second\n\nsee #2",
  createdAt: "2026-09-26T00:00:00.000Z",
}
const other: Issue = { ...BLANK, id: "2", title: "other issue", blocks: ["9"] }

function props(overrides: Partial<IssueViewProps> = {}): IssueViewProps {
  return {
    issue: topic,
    all: [topic, other],
    filters: { basePath: "/p/demo" },
    comments: [],
    questions: [],
    events: [],
    commits: [],
    draftDirty: false,
    saveState: "idle",
    onChange: () => {},
    onCommit: async () => {},
    onSave: async () => {},
    ...overrides,
  }
}

async function mount(node: ComponentChild): Promise<HTMLElement> {
  const { render } = await import("preact")
  if (!container) {
    container = window.document.createElement("div") as unknown as HTMLElement
    window.document.body.appendChild(container as never)
  }
  render(node, container)
  await settle()
  return container
}

// useEffect は描いた次の画面の更新 (requestAnimationFrame) のあとに動くので、それも待つ
async function settle(): Promise<void> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const actions: IssueActions = {
  openIssueMenuAt: () => {},
  openPropertyPicker: () => {},
  bulkSelection: [],
  toggleBulkSelection: () => {},
  retrySave: async () => {},
  returnedDrafts: {},
}

async function view(
  overrides: Partial<IssueViewProps> = {},
  issueActions: Partial<IssueActions> = {},
): Promise<HTMLElement> {
  const { IssueView } = await import("./issue-view")
  return mount(
    <IssueActionsContext.Provider value={{ ...actions, ...issueActions }}>
      <IssueView {...props(overrides)} />
    </IssueActionsContext.Provider>,
  )
}

function click(element: Element | null): void {
  if (!element) throw new Error("element to click is missing")
  element.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
  )
}

function byText(root: ParentNode, selector: string, text: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find((element) =>
    element.textContent?.includes(text),
  )
  if (!found) throw new Error(`no ${selector} with text: expected "${text}", actual none`)
  return found
}

function submitCommentForm(): void {
  const form = window.document.getElementById("comment-form")!
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as never)
}

test("a half-written answer stays with its question when a newer question arrives above it", async () => {
  const first = await view({ questions: [question("10", "AとBどちらにするか")] })
  const answer = first.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-10"]')!
  answer.value = "Bにしてください"
  // 質問は新しい順に並ぶので、後から来た Q11 は Q10 の上に入る
  const second = await view({
    questions: [question("11", "本番に反映してよいか"), question("10", "AとBどちらにするか")],
  })
  expect(
    second.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-10"]')!.value,
  ).toBe("Bにしてください")
  expect(
    second.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-11"]')!.value,
  ).toBe("")
})

test("questions waiting for an answer come before the title, answered ones stay below", async () => {
  const root = await view({
    questions: [
      question("11", "待っている質問"),
      question("10", "答えた質問", { status: "answered", answer: "はい" }),
    ],
  })
  const awaiting = root.querySelector("#q-11")!
  const answered = root.querySelector("#q-10")!
  const title = root.querySelector('textarea[name="title"]')!
  const before = (left: Element, right: Element) =>
    Boolean(left.compareDocumentPosition(right as never) & window.Node.DOCUMENT_POSITION_FOLLOWING)
  expect(before(awaiting, title)).toBe(true)
  expect(before(title, answered)).toBe(true)
  // 答えた質問には回答のフォームが要らない。答え待ちの質問だけ、戻り先に今の issue を載せたフォームを置く
  expect(root.querySelector("#answer-question-10")).toBeNull()
  const returnTo = root.querySelector<HTMLInputElement>(
    '#answer-question-11 input[name="returnTo"]',
  )!
  expect(returnTo.value).toBe("/p/demo/?id=1")
})

test("the mobile banner counts the waiting questions and expands them", async () => {
  const root = await view({
    questions: [question("11", "一つ目"), question("12", "二つ目")],
  })
  const banner = byText(root, "button", "2 questions awaiting answer")
  expect(banner.getAttribute("aria-expanded")).toBe("false")
  click(banner)
  await settle()
  expect(banner.getAttribute("aria-expanded")).toBe("true")
  const list = window.document.getElementById(banner.getAttribute("aria-controls")!)!
  expect(list.hasAttribute("data-expanded")).toBe(true)
})

test("the issue view is a modal dialog named by the issue title", async () => {
  const root = await view()
  const dialog = root.querySelector("#issue-view")!
  expect(dialog.getAttribute("role")).toBe("dialog")
  expect(dialog.getAttribute("aria-modal")).toBe("true")
  const heading = window.document.getElementById(dialog.getAttribute("aria-labelledby")!)!
  expect(heading.tagName).toBe("H1")
  expect(heading.textContent).toBe("topic")
})

test("opening an issue moves focus into the dialog, closing returns it to the row", async () => {
  const row = window.document.createElement("a")
  row.setAttribute("data-id", "1")
  row.setAttribute("href", "#")
  window.document.body.appendChild(row)
  await view()
  expect(window.document.activeElement?.closest("#issue-view")).not.toBeNull()
  const { render } = await import("preact")
  render(null, container!)
  await settle()
  expect(window.document.activeElement).toBe(row)
})

test("a new issue puts the cursor in the title, not in the description", async () => {
  const root = await view({ issue: { ...BLANK } })
  expect(window.document.activeElement).toBe(root.querySelector('textarea[name="title"]') as never)
  // 新しい issue でも説明を書きながら見た目を確かめられる
  expect(byText(root, "button", "Preview")).toBeDefined()
})

test("the title, description and comment fields are named for screen readers", async () => {
  const root = await view()
  expect(root.querySelector('textarea[name="title"]')!.getAttribute("aria-label")).toBe(
    "Issue title",
  )
  expect(root.querySelector('textarea[form="comment-form"]')!.getAttribute("aria-label")).toBe(
    "Comment",
  )
  click(byText(root, "button", "Edit"))
  await settle()
  expect(root.querySelector("#issue-description-editor")!.getAttribute("aria-label")).toBe(
    "Description",
  )
})

test("tapping the description on a touch screen does not start editing", async () => {
  setPointer(false)
  const root = await view()
  const preview = root.querySelector("#issue-description-preview")!
  expect(preview.getAttribute("role")).toBeNull()
  click(preview.querySelector("p") ?? preview)
  await settle()
  expect(root.querySelector("#issue-description-editor")).toBeNull()
  click(byText(root, "button", "Edit"))
  await settle()
  const editor = root.querySelector<HTMLTextAreaElement>("#issue-description-editor")!
  expect(editor.className).not.toContain("font-mono")
  expect(window.document.activeElement).toBe(editor as never)
})

test("clicking the description with a mouse starts editing", async () => {
  const root = await view()
  const preview = root.querySelector("#issue-description-preview")!
  click(preview.querySelector("p") ?? preview)
  await settle()
  expect(root.querySelector("#issue-description-editor")).not.toBeNull()
})

test("checking a task in the description saves the toggled markdown without editing", async () => {
  const commits: [DraftField, string][] = []
  const root = await view({
    onCommit: async (field, value) => {
      commits.push([field, value])
    },
  })
  click(root.querySelector('#issue-description-preview input[type="checkbox"]'))
  await settle()
  expect(commits).toEqual([["body", "- [x] first\n- [ ] second\n\nsee #2"]])
  expect(root.querySelector("#issue-description-editor")).toBeNull()
})

test("an issue number in the description opens that issue inside the app", async () => {
  const opened: string[] = []
  const root = await view({ onNavigate: (href) => opened.push(href) })
  const link = root.querySelector<HTMLAnchorElement>("#issue-description-preview a[data-issue]")!
  expect(link.getAttribute("href")).toBe("/p/demo/?id=2")
  click(link)
  await settle()
  expect(opened).toEqual(["/p/demo/?id=2"])
  expect(root.querySelector("#issue-description-editor")).toBeNull()
})

test("moving to another issue leaves the description editor", async () => {
  const root = await view()
  click(byText(root, "button", "Edit"))
  await settle()
  expect(root.querySelector("#issue-description-editor")).not.toBeNull()
  await view({ issue: { ...other, body: "other body" } })
  expect(root.querySelector("#issue-description-editor")).toBeNull()
})

test("choosing a status saves it once and closes the picker", async () => {
  const commits: [DraftField, string][] = []
  const root = await view({
    onCommit: async (field, value) => {
      commits.push([field, value])
    },
  })
  const trigger = root.querySelector<HTMLButtonElement>('[data-property="status"] button')!
  // 属性の行を label で包むと、候補を押したときに押したことが trigger へも届き、面が開き直る
  expect(trigger.closest("label")).toBeNull()
  click(trigger)
  await settle()
  click(byText(root, '[role="option"]', "In Progress"))
  await settle()
  expect(commits).toEqual([["status", "in_progress"]])
  expect(root.querySelector("[data-popover]")).toBeNull()
})

test("a property that fails to save shows the error next to it", async () => {
  const root = await view({
    onCommit: async () => {
      throw new Error("priority must be one of urgent, high, medium, low: actual huge")
    },
  })
  click(root.querySelector('[data-property="priority"] button'))
  await settle()
  click(byText(root, '[role="option"]', "Urgent"))
  await settle()
  const alert = root.querySelector('[data-property="priority"] [role="alert"]')!
  expect(alert.textContent).toContain("priority must be one of")
})

test("adding a label keeps the others", async () => {
  const commits: [DraftField, string][] = []
  const labeled = { ...topic, labels: ["backend"] }
  const root = await view({
    issue: labeled,
    all: [labeled, { ...other, labels: ["client"] }],
    onCommit: async (field, value) => {
      commits.push([field, value])
    },
  })
  click(root.querySelector('[data-property="labels"] button'))
  await settle()
  click(byText(root, '[role="option"]', "client"))
  await settle()
  expect(commits).toEqual([["labels", "backend, client"]])
})

test("assign to me uses the viewer's name", async () => {
  const commits: [DraftField, string][] = []
  const root = await view({
    viewer: "aovoq",
    onCommit: async (field, value) => {
      commits.push([field, value])
    },
  })
  click(root.querySelector('[data-property="assignee"] button'))
  await settle()
  click(byText(root, '[role="option"]', "Assign to me"))
  await settle()
  expect(commits).toEqual([["assignee", "aovoq"]])
})

test("marking an issue as blocking this one saves the blocks of that other issue", async () => {
  const patches: [string, unknown][] = []
  const root = await view({
    onPatchIssue: async (issueId, input) => {
      patches.push([issueId, input])
    },
  })
  click(root.querySelector('[data-property="blockedBy"] button'))
  await settle()
  click(byText(root, '[role="option"]', "other issue"))
  await settle()
  expect(patches).toEqual([["2", { blocks: ["9", "1"] }]])
})

test("the parent shows its number and title and links to it", async () => {
  const root = await view({ issue: { ...topic, parent: "2" } })
  const link = root.querySelector<HTMLAnchorElement>('[data-property="parent"] a')!
  expect(link.getAttribute("href")).toBe("/p/demo/?id=2")
  expect(link.getAttribute("title")).toBe("other issue")
  expect(link.textContent).toContain("#2")
})

test("the due date reads as text until it is edited", async () => {
  const root = await view()
  const due = root.querySelector('[data-property="dueDate"]')!
  expect(due.querySelector('input[type="date"]')).toBeNull()
  click(byText(due, "button", "Set due date"))
  await settle()
  expect(due.querySelector('input[type="date"]')).not.toBeNull()
})

test("where the agent worked on the issue is shown in the properties", async () => {
  const root = await view({
    issue: {
      ...topic,
      branch: "feat/add-inbox",
      worktree: "/Users/me/src/app-inbox",
      session: "0d6f1c2a-8e5b-4a0e-9d8e-1234567890ab",
    },
  })
  expect(root.querySelector('[data-property="branch"]')!.textContent).toContain("feat/add-inbox")
  expect(root.querySelector('[data-property="worktree"]')!.textContent).toContain("app-inbox")
  expect(root.querySelector('[data-property="session"]')!.textContent).toContain("0d6f1c2a")
})

test("property changes and commits appear on the issue", async () => {
  const root = await view({
    events: [
      {
        field: "priority",
        from: "high",
        to: "urgent",
        by: "aovoq",
        session: null,
        at: "2026-09-26T01:00:00.000Z",
      },
    ],
    commits: [
      {
        hash: "a1b2c3d",
        subject: "受け箱を足す #1",
        author: "aovoq",
        committedAt: "2026-09-26T02:00:00.000Z",
      },
    ],
  })
  expect(root.textContent).toContain("aovoq changed priority High → Urgent")
  expect(byText(root, "li", "受け箱を足す #1").textContent).toContain("a1b2c3d")
})

test("sub-issues can be added from their section and show done progress", async () => {
  const child = { ...BLANK, id: "3", title: "child", parent: "1", status: "done" }
  const root = await view({ all: [topic, other, child] })
  const add = root.querySelector<HTMLAnchorElement>('a[aria-label="Add sub-issue"]')!
  expect(add.getAttribute("href")).toBe("/p/demo/?id=new&new_parent=1")
  expect(root.querySelector('[role="progressbar"]')!.getAttribute("aria-label")).toBe(
    "Sub-issues done",
  )
})

test("a comment is posted without reloading and appears in the activity", async () => {
  const requests: { url: string; body: unknown }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(
      JSON.stringify({
        id: "5",
        issue: "1",
        parent: null,
        author: "aovoq",
        createdAt: "2026-09-26T03:00:00.000Z",
        updatedAt: "2026-09-26T03:00:00.000Z",
        body: "looks good",
      }),
      { headers: { "content-type": "application/json" } },
    )
  }) as unknown as typeof fetch
  const root = await view()
  const textarea = root.querySelector<HTMLTextAreaElement>('textarea[form="comment-form"]')!
  expect(textarea.required).toBe(true)
  textarea.value = "looks good"
  submitCommentForm()
  await settle()
  await settle()
  expect(requests).toEqual([
    { url: "/p/demo/api/comments", body: { issue: "1", body: "looks good" } },
  ])
  expect(byText(root, "li", "looks good")).toBeDefined()
  expect(textarea.value).toBe("")
})

test("a comment that fails to post keeps its text and says why", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "comment body is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch
  const root = await view()
  const textarea = root.querySelector<HTMLTextAreaElement>('textarea[form="comment-form"]')!
  textarea.value = "draft"
  submitCommentForm()
  await settle()
  await settle()
  expect(textarea.value).toBe("draft")
  expect(root.querySelector('[data-comment-error][role="alert"]')!.textContent).toContain(
    "comment body is required",
  )
})

test("an unsaved change that failed can be retried from the header", async () => {
  let retried = 0
  const root = await view(
    {
      draftDirty: true,
      saveState: "failed",
      error: "request failed: expected successful response, actual 500",
    },
    {
      retrySave: async () => {
        retried++
      },
    },
  )
  click(byText(root, "button", "Retry"))
  await settle()
  expect(retried).toBe(1)
})

test("the header menu button opens the issue menu under itself", async () => {
  const opened: [string, Element][] = []
  const root = await view(
    {},
    { openIssueMenuAt: (issueId, anchor) => opened.push([issueId, anchor]) },
  )
  const button = root.querySelector('button[aria-label="Issue actions"]')!
  click(button)
  expect(opened).toEqual([["1", button]])
})

test("the issue view renders on the server with the restored drafts", async () => {
  const { IssueView } = await import("./issue-view")
  const html = renderToString(
    <IssueActionsContext.Provider
      value={{
        ...actions,
        returnedDrafts: {
          comment: "書きかけのコメント",
          answer: { questionId: "11", text: "書きかけの回答" },
        },
      }}
    >
      <IssueView {...props({ questions: [question("11", "待っている質問")] })} />
    </IssueActionsContext.Provider>,
  )
  expect(html).toContain("書きかけのコメント")
  expect(html).toContain("書きかけの回答")
  expect(html).not.toContain('role="button"')
})
