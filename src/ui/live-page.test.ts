import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { installTestDom } from "../test-dom"
import { relativeTime } from "../time"
import { livePage, livePageScript } from "./live-page"

// livePage は document と sessionStorage などブラウザの globals を直に使うので、テストの間だけ happy-dom の window のものを入れる
const window = installTestDom()
const BROWSER_GLOBALS = [
  "sessionStorage",
  "localStorage",
  "location",
  "history",
  "HTMLDetailsElement",
]
const saved = new Map<string, unknown>()

beforeAll(() => {
  const globals = globalThis as Record<string, unknown>
  for (const name of BROWSER_GLOBALS) {
    saved.set(name, globals[name])
    globals[name] = (window as unknown as Record<string, unknown>)[name]
  }
})

// livePage が始めた見張りを、テストのたびに止める。止めないと他のテストの間も動き続けるため
const stops: (() => void)[] = []

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

afterAll(() => {
  const globals = globalThis as Record<string, unknown>
  for (const [name, value] of saved) globals[name] = value
})

const settings = {
  watch: { type: "poll" as const, inboxUrl: "/api/inbox", intervalMilliseconds: 3_600_000 },
  draftStorageKey: "yaru.drafts:test",
  returnParameters: ["error", "q", "answer", "workspace", "answered"],
  sidebarMin: 160,
  sidebarMax: 280,
}

function page(html: string) {
  window.sessionStorage.clear()
  window.history.replaceState(null, "", "http://127.0.0.1/p/app/dashboard")
  document.body.innerHTML = html
}

const CARD = `
  <form id="answer-question-1" method="post" action="/questions/1/answer"></form>
  <form id="answer-question-1-option" method="post" action="/questions/1/answer"></form>
  <textarea form="answer-question-1" data-answer-shortcut></textarea>
  <form id="answer-question-2" method="post" action="/questions/2/answer"></form>
  <textarea form="answer-question-2" data-answer-shortcut></textarea>
`

// 読み直し (新しい質問の知らせ・自動の読み直し) で書きかけの答えを失わないよう、質問のフォームごとに残して戻す
test("a draft typed into an answer box comes back after the page is loaded again", () => {
  page(CARD)
  stops.push(livePage(settings, relativeTime))
  const box = document.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-2"]')!
  box.value = "書きかけ"
  box.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  const stored = window.sessionStorage.getItem("yaru.drafts:test")
  expect(JSON.parse(stored!)).toEqual({ "answer-question-2": "書きかけ" })
  page(CARD)
  window.sessionStorage.setItem("yaru.drafts:test", stored!)
  stops.push(livePage(settings, relativeTime))
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-2"]')!.value,
  ).toBe("書きかけ")
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-1"]')!.value,
  ).toBe("")
})

// 送った答えを次に読み込んだときに戻すと、答えた質問の書きかけが別のカードに残ったように見える
test("sending an answer, even by an option button, forgets that question's draft", () => {
  page(CARD)
  window.sessionStorage.setItem(
    "yaru.drafts:test",
    JSON.stringify({ "answer-question-1": "a", "answer-question-2": "b" }),
  )
  stops.push(livePage(settings, relativeTime))
  document
    .getElementById("answer-question-1-option")!
    .dispatchEvent(new window.Event("submit", { bubbles: true }) as unknown as Event)
  expect(JSON.parse(window.sessionStorage.getItem("yaru.drafts:test")!)).toEqual({
    "answer-question-2": "b",
  })
})

// サーバーが返した書きかけ (?answer=) を、前に残した書きかけで上書きしない
test("a draft the server put back is kept over an older stored draft", () => {
  page(
    CARD.replace("data-answer-shortcut></textarea>", "data-answer-shortcut>戻った答え</textarea>"),
  )
  window.sessionStorage.setItem("yaru.drafts:test", JSON.stringify({ "answer-question-1": "古い" }))
  stops.push(livePage(settings, relativeTime))
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea[form="answer-question-1"]')!.value,
  ).toBe("戻った答え")
})

// 読み直したときに同じ失敗や取り消しの知らせが何度も出ないよう、一度きりの query を URL から外す
test("one-time return parameters are dropped from the address", () => {
  page(CARD)
  window.history.replaceState(
    null,
    "",
    "http://127.0.0.1/p/app/dashboard?error=x&q=1&answer=y&answered=2&view=list#q-1",
  )
  stops.push(livePage(settings, relativeTime))
  expect(window.location.href).toBe("http://127.0.0.1/p/app/dashboard?view=list#q-1")
})

test("a link to a card folded inside a closed details opens it", () => {
  page(`<details><summary>Q4</summary><article id="q-4"></article></details>`)
  window.history.replaceState(null, "", "http://127.0.0.1/p/app/dashboard#q-4")
  stops.push(livePage(settings, relativeTime))
  expect(document.querySelector("details")!.open).toBe(true)
})

test("the embedded script carries its own copy of the relative time and the answer shortcut", () => {
  const script = livePageScript({
    watch: { type: "events", eventsUrl: "/p/app/events", questionsUrl: "/p/app/api/questions" },
    draftStorageKey: "yaru.drafts:/p/app/dashboard",
  })
  expect(script).toContain('"eventsUrl":"/p/app/events"')
  expect(script).toContain('hasAttribute("data-answer-shortcut")')
  expect(() => new Function(script)).not.toThrow()
})

// 答えた直後は回答欄が無く入力中に見えないが、すぐ読み直すと取り消しの知らせが消えるので、押せる間は読み直しを待つ
test("while an undo is offered, a change shows the button instead of reloading", async () => {
  page(`
    <button id="page-refresh" hidden>Updated — Show</button>
    <div data-awaiting-ids="q-1" hidden></div>
    <div id="answer-toast" data-toast-expires-at="${new Date(Date.now() + 30_000).toISOString()}">
      <form data-undo-until="${new Date(Date.now() + 30_000).toISOString()}"></form>
    </div>
  `)
  const reload = window.location.reload
  let reloaded = false
  window.location.reload = () => {
    reloaded = true
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ groups: { blocking: [{ anchor: "q-1" }, { anchor: "q-2" }] } }),
    )) as unknown as typeof fetch
  try {
    stops.push(
      livePage(
        { ...settings, watch: { ...settings.watch, intervalMilliseconds: 10 } },
        relativeTime,
      ),
    )
    await Bun.sleep(50)
    expect(reloaded).toBe(false)
    expect(document.getElementById("page-refresh")!.hidden).toBe(false)
    expect(document.getElementById("page-refresh")!.textContent).toBe("1 new — Show")
  } finally {
    globalThis.fetch = originalFetch
    window.location.reload = reload
  }
})
