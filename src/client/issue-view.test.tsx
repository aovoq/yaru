import { afterAll, beforeAll, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { BLANK } from "../page"
import type { Question } from "../questions"

// 描き直しで DOM がどう使い回されるかは、実際の DOM に描かないと確かめられないので happy-dom を使う
const window = new Window()
const globals = globalThis as Record<string, unknown>
const saved: Record<string, unknown> = {}
const names = [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "requestAnimationFrame",
]

beforeAll(() => {
  for (const name of names) {
    saved[name] = globals[name]
    globals[name] =
      name === "window" ? window : (window as unknown as Record<string, unknown>)[name]
  }
})

afterAll(() => {
  for (const name of names) globals[name] = saved[name]
})

function question(id: string, title: string): Question {
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
  }
}

test("a half-written answer stays with its question when a newer question arrives above it", async () => {
  const { render } = await import("preact")
  const { IssueView } = await import("./issue-view")
  const issue = { ...BLANK, id: "1", title: "topic", createdAt: "2026-09-26T00:00:00.000Z" }
  const container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  const view = (questions: Question[]) => (
    <IssueView
      issue={issue}
      all={[issue]}
      filters={{}}
      labelInput=""
      blockInput=""
      comments={[]}
      questions={questions}
      draftDirty={false}
      saveState="idle"
      onChange={() => {}}
      onCommit={async () => {}}
      onSave={async () => {}}
    />
  )
  render(view([question("10", "AとBどちらにするか")]), container)
  const answer = container.querySelector<HTMLTextAreaElement>(
    'textarea[form="answer-question-10"]',
  )!
  answer.value = "Bにしてください"
  // 質問は新しい順に並ぶので、後から来た Q11 は Q10 の上に入る
  render(
    view([question("11", "本番に反映してよいか"), question("10", "AとBどちらにするか")]),
    container,
  )
  expect(
    container.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-10"]')!.value,
  ).toBe("Bにしてください")
  expect(
    container.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-11"]')!.value,
  ).toBe("")
})
