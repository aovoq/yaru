import { expect, test } from "bun:test"
import { installTestDom } from "../test-dom"
import { renderToString } from "preact-render-to-string"
import type { Question } from "../questions"
import { QuestionAnswerForm } from "./question-answer-form"
import { QuestionCard } from "./question-card"

const NOW = new Date("2026-09-26T12:00:00.000Z")

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "8",
    title: "称号を消すか",
    status: "open",
    issue: "4",
    priority: null,
    defaultAction: null,
    answerBy: null,
    options: [],
    author: "agent",
    session: null,
    worktree: null,
    branch: null,
    answer: null,
    answeredBy: null,
    answeredAt: null,
    acknowledgedAt: null,
    notifiedExpiringAt: null,
    canceledAt: null,
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-09-26T10:00:00.000Z",
    body: "",
    ...overrides,
  }
}

function card(overrides: Partial<Question> = {}): string {
  return renderToString(<QuestionCard question={question(overrides)} now={NOW} />)
}

function forms(overrides: Partial<Question> = {}, returnTo?: string): string {
  return renderToString(
    <QuestionAnswerForm question={question(overrides)} basePath="/p/app" returnTo={returnTo} />,
  )
}

test("the card can be linked to by the question id", () => {
  expect(card()).toContain('id="q-8"')
})

// 空の回答を送ると、エラーの画面に飛ばされて書きかけが消える。送る前にブラウザで止める
test("the answer box is required and named after the question for screen readers", () => {
  const html = card()
  expect(html).toMatch(/<textarea[^>]*required/)
  expect(html).toContain('aria-label="Answer to Q8"')
  expect(html).toContain('aria-describedby="q-8-title"')
  expect(html).toContain('id="q-8-title"')
  expect(html).toContain('form="answer-question-8"')
})

test("the answer button shows the keyboard shortcut on wide screens", () => {
  const html = card()
  expect(html).toContain('aria-keyshortcuts="Meta+Enter Control+Enter"')
  expect(html).toMatch(/hidden[^"]*sm:inline-flex[^>]*>.*⌘.*⏎/)
})

test("an open question with a default can be answered with the default", () => {
  const html = card({ defaultAction: "残す" })
  expect(html).toContain('name="useDefault"')
  expect(html).toContain(">Default<")
  expect(html).not.toContain("Dismiss")
})

test("options are offered as buttons that answer with the option, default first", () => {
  const html = card({ options: ["消す", "残す"], defaultAction: "残す" })
  const optionButtons = [...html.matchAll(/<button[^>]*form="answer-question-8-option"[^>]*>/g)]
  expect(optionButtons.map((match) => /value="([^"]*)"/.exec(match[0])?.[1])).toEqual([
    "残す",
    "消す",
  ])
  for (const match of optionButtons) {
    expect(match[0]).toContain('name="body"')
    expect(match[0]).toContain("formnovalidate")
  }
  // 既定が選択肢に入っていれば、同じ答えのボタンを 2 つ並べない
  expect(html).not.toContain('name="useDefault"')
})

// 期限切れの質問は、エージェントが既定で先に進んでいる。答えても使われないかもしれないことを伝え、取り下げを主な操作にする
test("an expired question says the agent proceeded and offers dismiss before answering anyway", () => {
  const html = card({
    status: "expired",
    answerBy: "2026-09-26T11:00:00.000Z",
    defaultAction: "残す",
  })
  expect(html).toContain("data-danger")
  expect(html).toContain("Proceeded with default")
  expect(html).toContain('form="cancel-question-8"')
  expect(html).toContain("Dismiss")
  expect(html).toContain("Answer anyway")
  expect(html).toContain("Agent may have moved on")
  expect(html).not.toContain('name="useDefault"')
  expect(html.indexOf("Answer anyway")).toBeLessThan(html.indexOf("Dismiss"))
})

test("an answered question folds into one line that opens to the full answer", () => {
  const html = card({
    status: "answered",
    answer: "**消してよい**\n\n理由は後で",
    answeredBy: "human",
    answeredAt: "2026-09-26T11:00:00.000Z",
  })
  expect(html).toMatch(/^<article[^>]*><details/)
  expect(html).not.toContain("<details open")
  expect(html).toContain("Answered 1h ago")
  expect(html).toContain("<strong>消してよい</strong>")
  expect(html).not.toContain("<textarea")
})

test("an answered question tells whether the agent has picked up the answer", () => {
  const answered = {
    status: "answered" as const,
    answer: "はい",
    answeredBy: "human",
    answeredAt: "2026-09-26T11:00:00.000Z",
  }
  expect(card({ ...answered, acknowledgedAt: null })).toContain("Not picked up")
  expect(card({ ...answered, acknowledgedAt: "2026-09-26T11:30:00.000Z" })).toContain(
    "Picked up 30m ago",
  )
})

test("the answer form sends the status the card was drawn with so a stale tab cannot overwrite", () => {
  const html = forms({ status: "expired", answerBy: "2026-09-26T11:00:00.000Z" }, "/p/app/?id=4")
  expect(html).toContain('id="answer-question-8"')
  expect(html).toMatch(/id="answer-question-8"[^>]*>.*name="expectedStatus" value="expired"/)
  expect(html).toContain('name="returnTo" value="/p/app/?id=4"')
})

test("the dismiss form cancels the question and exists only while the question is expired", () => {
  const expired = forms({ status: "expired", answerBy: "2026-09-26T11:00:00.000Z" })
  expect(expired).toContain('id="cancel-question-8"')
  expect(expired).toContain('action="/p/app/questions/8/cancel"')
  expect(forms()).not.toContain("cancel-question-8")
})

test("the option form exists only when the question has options", () => {
  expect(forms({ options: ["a", "b"] })).toContain('id="answer-question-8-option"')
  expect(forms()).not.toContain("answer-question-8-option")
})

test("an answered question has no forms", () => {
  expect(forms({ status: "answered", answer: "x" })).toBe("")
})

// ここから下は実際の DOM に描いて、キーボードの操作と描き直しを確かめる
const window = installTestDom()

async function mountBoth(value: Question) {
  const { render } = await import("preact")
  const container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  const draw = (current: Question) =>
    render(
      <>
        <QuestionCard question={current} now={NOW} />
        <QuestionAnswerForm question={current} basePath="" />
      </>,
      container,
    )
  draw(value)
  return { container, draw }
}

test("Cmd+Enter or Ctrl+Enter in the answer box submits its own answer form, not the page's form", async () => {
  const { container } = await mountBoth(question())
  const form = container.querySelector<HTMLFormElement>("#answer-question-8")!
  let submitted = 0
  form.requestSubmit = () => {
    submitted++
  }
  let reachedDocument = 0
  const onDocumentKeyDown = () => reachedDocument++
  window.document.addEventListener("keydown", onDocumentKeyDown)
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    textarea.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...modifier,
      }) as unknown as Event,
    )
  }
  // 修飾キーの無い Enter は改行なので送らない
  textarea.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event,
  )
  window.document.removeEventListener("keydown", onDocumentKeyDown)
  expect(submitted).toBe(2)
  // 板の Cmd+Enter は issue のフォームを送るので、回答欄の Cmd+Enter はそこまで届かせない
  expect(reachedDocument).toBe(1)
})

// 期限切れは読むたびに決まるので、答えを書いている途中で open から expired に変わることがある
test("a half-written answer survives the question expiring while it is being written", async () => {
  const { container, draw } = await mountBoth(question({ answerBy: "2026-09-26T13:00:00.000Z" }))
  container.querySelector<HTMLTextAreaElement>("textarea")!.value = "書きかけ"
  draw(question({ status: "expired", answerBy: "2026-09-26T13:00:00.000Z" }))
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("書きかけ")
})

// dashboard はスクリプトで描き直さないので、回答欄の Cmd+Enter は inline script が受け持つ
test("the dashboard's inline script submits the answer form on Cmd+Enter", async () => {
  const { ANSWER_SHORTCUT_SCRIPT } = await import("./question-answer")
  const container = window.document.createElement("div")
  window.document.body.appendChild(container)
  container.innerHTML = renderToString(
    <>
      <QuestionCard question={question({ id: "30" })} now={NOW} />
      <QuestionAnswerForm question={question({ id: "30" })} basePath="" />
    </>,
  )
  const form = container.querySelector("#answer-question-30") as unknown as HTMLFormElement
  let submitted = 0
  form.requestSubmit = () => {
    submitted++
  }
  const listener = new Function(
    "document",
    "HTMLTextAreaElement",
    "HTMLFormElement",
    ANSWER_SHORTCUT_SCRIPT,
  )
  listener(window.document, window.HTMLTextAreaElement, window.HTMLFormElement)
  container
    .querySelector("textarea")!
    .dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    )
  expect(submitted).toBe(1)
})

// /inbox は全ワークスペースの質問を 1 画面に並べ、質問の番号はワークスペースごとに 1 から振られる
// id が質問の番号だけだと、別のワークスペースの Q1 の入力欄が先に出た Q1 のフォームに結びついて、別のワークスペースへ答えてしまう
test("a scope keeps the card and its forms apart from another workspace's question of the same id", () => {
  const scoped = renderToString(
    <>
      <QuestionCard
        question={question({ status: "expired", options: ["a"] })}
        now={NOW}
        scope="app"
      />
      <QuestionAnswerForm
        question={question({ status: "expired", options: ["a"] })}
        basePath="/p/app"
        scope="app"
      />
    </>,
  )
  expect(scoped).toContain('id="q-app-8"')
  expect(scoped).toContain('aria-describedby="q-app-8-title"')
  expect(scoped).toContain('id="answer-question-app-8"')
  expect(scoped).toContain('form="answer-question-app-8"')
  expect(scoped).toContain('id="answer-question-app-8-option"')
  expect(scoped).toContain('form="answer-question-app-8-option"')
  expect(scoped).toContain('id="cancel-question-app-8"')
  expect(scoped).toContain('form="cancel-question-app-8"')
  expect(scoped).not.toContain('id="q-8"')
})

test("the card names its workspace when questions from several workspaces are mixed", () => {
  const html = renderToString(
    <QuestionCard
      question={question()}
      now={NOW}
      workspace={{ name: "AsukaTravel", href: "/p/AsukaTravel/dashboard#q-8" }}
    />,
  )
  expect(html).toMatch(/href="\/p\/AsukaTravel\/dashboard#q-8"[^>]*>[\s\S]*?AsukaTravel/)
})

// 送った答えが断られて戻ってきたら、書きかけの答えと理由をそのカードの中に出し、どこで何が起きたかを探させない
test("a draft and an error returned from a failed answer are shown inside the card", () => {
  const html = renderToString(
    <QuestionCard
      question={question()}
      now={NOW}
      draft="書きかけの答え"
      error="invalid answer: expected a non-empty string"
    />,
  )
  expect(html).toMatch(/<textarea[^>]*>書きかけの答え<\/textarea>/)
  expect(html).toContain('role="alert"')
  expect(html).toContain("invalid answer: expected a non-empty string")
})

// 答えたあとは次の質問へ進めるよう、次のカードの id をフォームに持たせてサーバーの戻り先の fragment にする
test("the forms carry the anchor of the next card to return to", () => {
  const html = renderToString(
    <QuestionAnswerForm question={question({ options: ["a"] })} basePath="" next="q-9" />,
  )
  expect(html.match(/name="next" value="q-9"/g)?.length).toBe(2)
})
