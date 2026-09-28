import { Code, ConnectError } from "@connectrpc/connect"
import { afterEach, expect, test } from "vitest"
import type { ComponentChild } from "preact"
import { installTestDom } from "../test-dom"
import {
  IssueStatus,
  IssueView,
  QuestionStatus,
  type Issue as ProtoIssue,
  type Question as ProtoQuestion,
} from "../gen/yaru/v1/common_pb"
import type { BoardQuery } from "../route"
import { IssueScreen, type IssueClients } from "./issue-screen"
import type { GetPageInit, PageResponse, SaveIssueInit } from "./proto"

const window = installTestDom()
let container: HTMLElement | undefined

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  container = undefined
  window.document.body.innerHTML = ""
  window.document.title = ""
  setPointer(true)
})

function setPointer(fine: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: fine && query.includes("pointer: fine"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false
    },
    onchange: null,
  })) as unknown as typeof window.matchMedia
}
setPointer(true)

const NOW = "2020-01-15T00:00:00.000Z"

function boardQuery(overrides: Partial<BoardQuery> = {}): BoardQuery {
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
    ...overrides,
  }
}

function protoIssue(overrides: Partial<ProtoIssue> = {}): ProtoIssue {
  return {
    id: "1",
    title: "topic",
    status: IssueStatus.TODO,
    labels: [],
    blocks: [],
    blockedBy: [],
    children: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    stale: false,
    body: "- [ ] first\n- [ ] second\n\nsee #2",
    ...overrides,
  } as ProtoIssue
}

function page(overrides: Partial<PageResponse> = {}): PageResponse {
  const current = overrides.current === undefined ? protoIssue() : overrides.current
  const other = protoIssue({ id: "2", title: "other issue", body: "", blocks: ["9"] })
  return {
    issues: current ? [current] : [],
    all: current ? [current, other] : [other],
    query: "",
    current,
    comments: [],
    questions: [],
    events: [],
    commits: [],
    awaiting: false,
    view: IssueView.LIST,
    basePath: "/p/demo",
    viewer: "aovoq",
    now: NOW,
    ...overrides,
  }
}

function question(
  id: string,
  title: string,
  overrides: Partial<ProtoQuestion> = {},
): ProtoQuestion {
  return {
    id,
    title,
    status: QuestionStatus.OPEN,
    issue: "1",
    options: [],
    author: "agent",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    body: "",
    ...overrides,
  } as ProtoQuestion
}

type Harness = {
  clients: IssueClients
  pages: GetPageInit[]
  saves: SaveIssueInit[]
  comments: { workspace: string; issue?: string; body?: string }[]
  answers: { id: string; body?: string; expectedStatus?: number }[]
  setPage: (next: PageResponse) => void
  failSave: (error: Error | null) => void
}

function harness(initial: PageResponse): Harness {
  let current = initial
  let saveError: Error | null = null
  const pages: GetPageInit[] = []
  const saves: SaveIssueInit[] = []
  const comments: Harness["comments"] = []
  const answers: Harness["answers"] = []
  const clients = {
    page: {
      getPage: async (request: GetPageInit) => {
        pages.push(request)
        return current
      },
    },
    issues: {
      saveIssue: async (request: SaveIssueInit) => {
        saves.push(request)
        if (saveError) throw saveError
        if (!request.id && current.current) {
          const created = {
            ...current.current,
            id: "8",
            title: request.title ?? current.current.title,
          }
          current = { ...current, current: created }
          return { issue: created, now: current.now }
        }
        return { issue: current.current, now: current.now }
      },
    },
    comments: {
      saveComment: async (request: { workspace: string; issue?: string; body?: string }) => {
        comments.push(request)
        return {
          comment: {
            id: "5",
            issue: request.issue ?? "",
            author: "aovoq",
            createdAt: "2020-01-14T00:00:00.000Z",
            updatedAt: "2020-01-14T00:00:00.000Z",
            body: request.body ?? "",
          },
        }
      },
    },
    questions: {
      answerQuestion: async (request: { id: string; body?: string; expectedStatus?: number }) => {
        answers.push(request)
        return {
          question: question(request.id, "待っている質問", {
            status: QuestionStatus.ANSWERED,
            answer: request.body,
            answeredAt: NOW,
            answeredBy: "aovoq",
          }),
          now: NOW,
        }
      },
      undoAnswer: async () => ({ now: NOW }),
      cancelQuestion: async () => ({ now: NOW }),
    },
  } as unknown as IssueClients
  return {
    clients,
    pages,
    saves,
    comments,
    answers,
    setPage: (next) => {
      current = next
    },
    failSave: (error) => {
      saveError = error
    },
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
  await settle()
  return container
}

async function settle(): Promise<void> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
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

test("opening an issue reads GetPage and shows the title against the response clock", async () => {
  const api = harness(page())
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  expect(api.pages[0]).toMatchObject({ workspace: "demo", id: "1" })
  const title = root.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!
  expect(title.value).toBe("topic")
  expect(root.textContent).toContain("Created 14d ago")
  expect(root.querySelector("#issue-view")?.getAttribute("role")).toBe("dialog")
  expect(root.querySelector("#issue-view")?.hasAttribute("aria-modal")).toBe(false)
  expect(window.document.title).toBe("#1 topic · demo · yaru")
})

test("a new issue focuses the title and creates through SaveIssue without an id", async () => {
  const draft = protoIssue({ id: "", title: "", body: "", createdAt: "", updatedAt: "" })
  const api = harness(page({ current: draft, all: [] }))
  const opened: string[] = []
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="new"
      query={boardQuery({ newStatus: "todo" })}
      clients={api.clients}
      onNavigate={(href) => opened.push(href)}
    />,
  )
  const title = root.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!
  expect(window.document.activeElement).toBe(title)
  expect(byText(root, "button", "Preview")).toBeDefined()
  title.value = "Hello"
  title.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  title.dispatchEvent(new window.FocusEvent("blur") as unknown as Event)
  await settle()
  expect(api.saves).toEqual([])
  click(byText(root, "button", "Create issue"))
  await settle()
  await settle()
  expect(api.saves[0]).toMatchObject({
    workspace: "demo",
    title: "Hello",
    status: IssueStatus.TODO,
  })
  expect(api.saves[0]?.id).toBeUndefined()
  expect(opened).toEqual(["/p/demo/?id=8"])
})

test("choosing a status saves that field once", async () => {
  const api = harness(page())
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  click(root.querySelector('[data-property="status"] button'))
  await settle()
  click(byText(root, '[role="option"]', "In Progress"))
  await settle()
  await settle()
  expect(api.saves).toEqual([{ workspace: "demo", id: "1", status: IssueStatus.IN_PROGRESS }])
  expect(root.querySelector("[data-popover]")).toBeNull()
})

test("a rejected property is reverted and the reason sits on that row", async () => {
  const api = harness(page())
  api.failSave(
    new ConnectError(
      "priority must be one of urgent, high, medium, low: actual huge",
      Code.InvalidArgument,
    ),
  )
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  click(root.querySelector('[data-property="priority"] button'))
  await settle()
  click(byText(root, '[role="option"]', "Urgent"))
  await settle()
  await settle()
  expect(root.querySelector('[data-property="priority"] [role="alert"]')?.textContent).toContain(
    "priority must be one of",
  )
  expect(root.querySelector('[data-property="priority"]')?.textContent).toContain("No priority")
  expect(root.textContent?.includes("Retry")).toBe(false)
})

test("a failed save keeps the draft and Retry sends it again", async () => {
  const api = harness(page())
  api.failSave(new ConnectError("upstream unavailable", Code.Unavailable))
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  const title = root.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!
  title.value = "retitled"
  title.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  title.dispatchEvent(new window.FocusEvent("blur") as unknown as Event)
  await settle()
  await settle()
  expect(root.textContent).toContain("Unsaved")
  api.failSave(null)
  api.setPage(page({ current: protoIssue({ title: "retitled" }) }))
  click(byText(root, "button", "Retry"))
  await settle()
  await settle()
  expect(api.saves.at(-1)).toMatchObject({ id: "1", title: "retitled" })
  expect(root.textContent).toContain("Saved")
})

test("a failed save is sent again once after the workspace watch refreshes", async () => {
  const api = harness(page())
  api.failSave(new ConnectError("upstream unavailable", Code.Unavailable))
  let refetch = () => {}
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
      watch={(refresh) => {
        refetch = refresh
        return () => {}
      }}
    />,
  )
  const title = root.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!
  title.value = "retitled"
  title.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  title.dispatchEvent(new window.FocusEvent("blur") as unknown as Event)
  await settle()
  await settle()
  expect(api.saves).toHaveLength(1)
  api.failSave(null)
  refetch()
  await settle()
  await settle()
  await settle()
  expect(api.saves).toHaveLength(2)
  expect(api.saves[1]).toMatchObject({ id: "1", title: "retitled" })
})

test("a live refresh keeps the title that is still being typed", async () => {
  const api = harness(page())
  let refetch = () => {}
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
      watch={(refresh) => {
        refetch = refresh
        return () => {}
      }}
    />,
  )
  const title = root.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!
  title.value = "typing"
  title.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  await settle()
  refetch()
  await settle()
  await settle()
  expect(root.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!.value).toBe("typing")
})

test("checking a task saves the toggled markdown", async () => {
  const api = harness(page())
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  click(root.querySelector('#issue-description-preview input[type="checkbox"]'))
  await settle()
  await settle()
  expect(api.saves[0]?.bodyChange).toEqual({
    case: "body",
    value: "- [x] first\n- [ ] second\n\nsee #2",
  })
})

test("an issue link inside the description asks the board to open it", async () => {
  const opened: string[] = []
  const api = harness(page())
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={(href) => opened.push(href)}
    />,
  )
  click(root.querySelector("#issue-description-preview a[data-issue]"))
  expect(opened).toEqual(["/p/demo/?id=2"])
})

test("marking another issue as blocking this one saves that issue's blocks", async () => {
  const api = harness(page())
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  click(root.querySelector('[data-property="blockedBy"] button'))
  await settle()
  click(byText(root, '[role="option"]', "other issue"))
  await settle()
  await settle()
  expect(api.saves).toEqual([
    {
      workspace: "demo",
      id: "2",
      blocksChange: { case: "blocks", value: { values: ["9", "1"] } },
    },
  ])
})

test("sub-issues, commits, and activity use the page payload", async () => {
  const child = protoIssue({
    id: "3",
    title: "child",
    parent: "1",
    status: IssueStatus.DONE,
    body: "",
  })
  const api = harness(
    page({
      all: [
        protoIssue(),
        protoIssue({ id: "2", title: "other issue", body: "", blocks: ["9"] }),
        child,
      ],
      events: [
        {
          field: "priority",
          fromValue: { case: "fromText", value: "high" },
          toValue: { case: "toText", value: "urgent" },
          by: "aovoq",
          at: "2020-01-02T00:00:00.000Z",
        },
      ] as PageResponse["events"],
      commits: [
        {
          hash: "a1b2c3d",
          subject: "受け箱を足す #1",
          author: "aovoq",
          committedAt: "2020-01-03T00:00:00.000Z",
          pushed: false,
        },
      ] as PageResponse["commits"],
    }),
  )
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  expect(root.querySelector('a[aria-label="Add sub-issue"]')?.getAttribute("href")).toBe(
    "/p/demo/?id=new&new_parent=1",
  )
  expect(root.textContent).toContain("aovoq changed priority High → Urgent")
  const commit = byText(root, "li", "受け箱を足す #1")
  expect(commit.getAttribute("data-pushed")).toBe("false")
  expect(commit.textContent).toContain("Not pushed")
})

test("a comment is posted through SaveComment and appears in the activity", async () => {
  const api = harness(page())
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  const textarea = root.querySelector<HTMLTextAreaElement>('textarea[form="comment-form"]')!
  textarea.value = "looks good"
  window.document
    .getElementById("comment-form")!
    .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as never)
  await settle()
  await settle()
  expect(api.comments).toEqual([{ workspace: "demo", issue: "1", body: "looks good" }])
  expect(byText(root, "li", "looks good")).toBeDefined()
  expect(textarea.value).toBe("")
})

test("a comment that fails to post keeps its text and says why", async () => {
  const api = harness(page())
  api.clients.comments.saveComment = async () => {
    throw new Error("comment body is required")
  }
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  const textarea = root.querySelector<HTMLTextAreaElement>('textarea[form="comment-form"]')!
  textarea.value = "draft"
  window.document
    .getElementById("comment-form")!
    .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as never)
  await settle()
  await settle()
  expect(textarea.value).toBe("draft")
  expect(root.querySelector("[data-comment-error]")?.textContent).toContain(
    "comment body is required",
  )
})

test("a waiting question is above the title and answering it calls AnswerQuestion", async () => {
  const api = harness(page({ questions: [question("11", "待っている質問")] }))
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  const card = root.querySelector("#q-11")!
  const title = root.querySelector('textarea[name="title"]')!
  expect(
    Boolean(card.compareDocumentPosition(title) & window.Node.DOCUMENT_POSITION_FOLLOWING),
  ).toBe(true)
  const answer = root.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-11"]')!
  answer.value = "Bにしてください"
  window.document
    .getElementById("answer-question-11")!
    .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as never)
  await settle()
  await settle()
  expect(api.answers).toEqual([
    { id: "11", body: "Bにしてください", expectedStatus: QuestionStatus.OPEN, workspace: "demo" },
  ])
  expect(root.textContent).toContain("Answered Q11")
})

test("a returned comment draft is put back into the comment field", async () => {
  const api = harness(page())
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery({ comment: "書きかけのコメント" })}
      clients={api.clients}
      onNavigate={() => {}}
    />,
  )
  expect(root.querySelector<HTMLTextAreaElement>('textarea[form="comment-form"]')!.value).toBe(
    "書きかけのコメント",
  )
})

test("closing a new issue with a title asks before discarding it", async () => {
  const draft = protoIssue({ id: "", title: "", body: "", createdAt: "", updatedAt: "" })
  const api = harness(page({ current: draft, all: [] }))
  const opened: string[] = []
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="new"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={(href) => opened.push(href)}
    />,
  )
  const title = root.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!
  title.value = "Hello"
  title.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  await settle()
  click(root.querySelector("#drawer-close"))
  await settle()
  expect(root.textContent).toContain("Discard changes?")
  expect(root.textContent).toContain("This new issue has not been created yet.")
  click(byText(root, "button", "Keep editing"))
  await settle()
  expect(opened).toEqual([])
  expect(root.querySelector("#issue-view")).not.toBeNull()
  click(root.querySelector("#drawer-close"))
  await settle()
  click(byText(root, "button", "Discard"))
  await settle()
  expect(opened).toEqual(["/p/demo/"])
})

test("a missing issue tells the board and does not open the dialog", async () => {
  const api = harness(page({ current: undefined, error: "issue not found: 9" }))
  const opened: string[] = []
  const missing: string[] = []
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="9"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={(href) => opened.push(href)}
      onUnavailable={(message) => missing.push(message)}
    />,
  )
  expect(missing).toEqual(["issue not found: 9"])
  expect(opened).toEqual(["/p/demo/"])
  expect(root.querySelector("#issue-view")).toBeNull()
})

test("Escape leaves a field before it closes a clean issue", async () => {
  const api = harness(page())
  const opened: string[] = []
  const root = await mount(
    <IssueScreen
      workspace="demo"
      issueId="1"
      query={boardQuery()}
      clients={api.clients}
      onNavigate={(href) => opened.push(href)}
    />,
  )
  const title = root.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!
  title.focus()
  title.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event,
  )
  await settle()
  expect(opened).toEqual([])
  window.document.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as never,
  )
  await settle()
  expect(opened).toEqual(["/p/demo/"])
})
