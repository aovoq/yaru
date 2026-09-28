import { Code, ConnectError } from "@connectrpc/connect"
import type { ComponentChild } from "preact"
import { afterEach, expect, test } from "vitest"
import { QuestionStatus } from "../gen/yaru/v1/common_pb"
import { installTestDom } from "../test-dom"
import {
  DashboardScreen,
  type DashboardClient,
  type DashboardResponseLike,
} from "./dashboard-screen"
import type { QuestionRpc } from "../components/perform-question-action"

const window = installTestDom()
const globals = globalThis as Record<string, unknown>
for (const name of ["sessionStorage", "localStorage", "location", "history"]) {
  globals[name] = (window as unknown as Record<string, unknown>)[name]
}

const NOW = "2026-09-28T12:00:00.000Z"

function response(overrides: Partial<DashboardResponseLike> = {}): DashboardResponseLike {
  return {
    now: NOW,
    questions: [
      {
        id: "1",
        title: "先に答える",
        status: QuestionStatus.OPEN,
        defaultAction: "残す",
        answerBy: "2026-09-28T12:30:00.000Z",
        options: [],
        author: "agent",
        createdAt: "2026-09-28T10:00:00.000Z",
        updatedAt: "2026-09-28T10:00:00.000Z",
        body: "本文",
      },
    ],
    issues: [],
    sessionHealth: {
      windowDays: 7,
      sessions: [],
      totals: { sessions: 0, costUsd: 0, unpricedMessages: 0, assistantMessages: 0 },
    },
    ...overrides,
  }
}

let container: HTMLElement

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  window.sessionStorage.clear()
  window.document.body.innerHTML = ""
})

async function mount(node: ComponentChild): Promise<void> {
  const { render } = await import("preact")
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(node, container)
  await settle()
}

async function settle(): Promise<void> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
}

const query = { questionId: null, error: null, answer: null, answered: null }

test("the dashboard loads questions from GetDashboard and answers through the RPC", async () => {
  const calls: { workspace: string; id: string; body?: string; expectedStatus?: number }[] = []
  const client: DashboardClient = { getDashboard: async () => response() }
  const questions: QuestionRpc = {
    answerQuestion: async (request) => {
      calls.push(request)
      return {
        now: NOW,
        question: {
          id: "1",
          title: "先に答える",
          status: QuestionStatus.ANSWERED,
          answer: "残してよい",
          answeredAt: "2026-09-28T11:59:55.000Z",
          options: [],
          author: "agent",
          createdAt: "2026-09-28T10:00:00.000Z",
          updatedAt: NOW,
        },
      }
    },
    undoAnswer: async () => {
      throw new Error("undo was not asked")
    },
    cancelQuestion: async () => {
      throw new Error("cancel was not asked")
    },
  }
  await mount(
    <DashboardScreen
      slug="app"
      query={query}
      fragment={null}
      client={client}
      questions={questions}
      watch={null}
    />,
  )
  expect(container.textContent).toContain("先に答える")
  const box = container.querySelector<HTMLTextAreaElement>("textarea")!
  box.value = "残してよい"
  const form = container.querySelector<HTMLFormElement>("#answer-question-1")!
  form.dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event,
  )
  await settle()
  expect(calls).toEqual([
    {
      workspace: "app",
      id: "1",
      body: "残してよい",
      expectedStatus: QuestionStatus.OPEN,
    },
  ])
  expect(container.textContent).toContain("Answered Q1")
  expect(container.querySelector("#answer-toast form")?.getAttribute("action")).toBe(
    "/p/app/questions/1/undo",
  )
})

test("a refused answer is shown on the card with the draft", async () => {
  const client: DashboardClient = { getDashboard: async () => response() }
  const questions: QuestionRpc = {
    answerQuestion: async () => {
      throw new ConnectError("cannot answer question 1: actual answered", Code.Aborted)
    },
    undoAnswer: async () => {
      throw new Error("unused")
    },
    cancelQuestion: async () => {
      throw new Error("unused")
    },
  }
  await mount(
    <DashboardScreen
      slug="app"
      query={query}
      fragment={null}
      client={client}
      questions={questions}
      watch={null}
    />,
  )
  const box = container.querySelector<HTMLTextAreaElement>("textarea")!
  box.value = "書きかけ"
  container
    .querySelector("#answer-question-1")!
    .dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  await settle()
  expect(container.textContent).toContain("cannot answer question 1: actual answered")
  expect(container.querySelector("textarea")!.value).toBe("書きかけ")
})

test("while a draft is typed, a watch update shows N new instead of replacing the question", async () => {
  let current = response()
  const client: DashboardClient = {
    getDashboard: async () => current,
  }
  let refetch = () => {}
  await mount(
    <DashboardScreen
      slug="app"
      query={query}
      fragment={null}
      client={client}
      questions={unusedQuestions()}
      watch={(options) => {
        refetch = options.refetch
        return Promise.resolve()
      }}
    />,
  )
  const box = container.querySelector<HTMLTextAreaElement>("textarea")!
  box.value = "書きかけ"
  box.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  await settle()
  current = response({
    questions: [
      ...(current.questions ?? []),
      {
        id: "2",
        title: "新しい質問",
        status: QuestionStatus.OPEN,
        options: [],
        author: "agent",
        createdAt: NOW,
        updatedAt: NOW,
        body: "",
      },
    ],
  })
  refetch()
  await settle()
  await settle()
  const button = container.querySelector<HTMLButtonElement>("#page-refresh")!
  expect(button.hidden).toBe(false)
  expect(button.textContent).toBe("1 new — Show")
  expect(container.textContent).not.toContain("新しい質問")
  button.click()
  await settle()
  await settle()
  expect(container.textContent).toContain("新しい質問")
})

test("our own answer does not raise the refresh button when the watch echoes it", async () => {
  let current = response()
  const client: DashboardClient = { getDashboard: async () => current }
  let refetch = () => {}
  const questions: QuestionRpc = {
    answerQuestion: async () => {
      const answered = {
        id: "1",
        title: "先に答える",
        status: QuestionStatus.ANSWERED,
        answer: "残してよい",
        answeredAt: "2026-09-28T11:59:55.000Z",
        options: [],
        author: "agent",
        createdAt: "2026-09-28T10:00:00.000Z",
        updatedAt: NOW,
        body: "本文",
      }
      current = response({
        questions: [answered],
      })
      return { now: NOW, question: answered }
    },
    undoAnswer: async () => {
      throw new Error("unused")
    },
    cancelQuestion: async () => {
      throw new Error("unused")
    },
  }
  await mount(
    <DashboardScreen
      slug="app"
      query={query}
      fragment={null}
      client={client}
      questions={questions}
      watch={(options) => {
        refetch = options.refetch
        return Promise.resolve()
      }}
    />,
  )
  const box = container.querySelector<HTMLTextAreaElement>("textarea")!
  box.value = "残してよい"
  box.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  await settle()
  container
    .querySelector("#answer-question-1")!
    .dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  await settle()
  refetch()
  await settle()
  refetch()
  await settle()
  await settle()
  const button = container.querySelector<HTMLButtonElement>("#page-refresh")!
  expect(button.hidden).toBe(true)
  expect(container.textContent).toContain("Answered Q1")
})

test("a stored draft is restored into the empty answer box", async () => {
  window.sessionStorage.setItem(
    "yaru.drafts:/p/app/dashboard",
    JSON.stringify({ "answer-question-1": "書きかけ" }),
  )
  await mount(
    <DashboardScreen
      slug="app"
      query={query}
      fragment={null}
      client={{ getDashboard: async () => response() }}
      questions={unusedQuestions()}
      watch={null}
    />,
  )
  expect(container.querySelector("textarea")!.value).toBe("書きかけ")
})

test("a missing workspace is a not found error", async () => {
  const client: DashboardClient = {
    getDashboard: async () => {
      throw new ConnectError("workspace not found: missing", Code.NotFound)
    },
  }
  await mount(
    <DashboardScreen
      slug="missing"
      query={query}
      fragment={null}
      client={client}
      questions={unusedQuestions()}
      watch={null}
    />,
  )
  expect(container.textContent).toContain("workspace not found: missing")
  expect(container.textContent).toContain("back")
})

function unusedQuestions(): QuestionRpc {
  const fail = async () => {
    throw new Error("question rpc was not asked")
  }
  return { answerQuestion: fail, undoAnswer: fail, cancelQuestion: fail }
}
