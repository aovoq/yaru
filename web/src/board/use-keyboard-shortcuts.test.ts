import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { installTestDom } from "../test-dom"
import { handleBoardKey, type KeyboardContext } from "./use-keyboard-shortcuts"

// キーを受ける場所と focus の位置で結果が変わるので、実際の DOM にキーを送って確かめる
const window = installTestDom()
const document = window.document as unknown as Document

type Call = [string, ...unknown[]]
let calls: Call[]
let context: KeyboardContext

function makeContext(overrides: Partial<KeyboardContext> = {}): KeyboardContext {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args])
    }
  return {
    issueOpen: false,
    currentIssueId: null,
    selectedIssueId: null,
    bulkSelection: [],
    overlayOpen: false,
    newIssueHref: "/?id=new",
    issueHref: (issueId) => `/?id=${issueId}`,
    navigate: record("navigate"),
    selectIssue: record("selectIssue"),
    openIssueMenu: (issueId, anchor) => calls.push(["openIssueMenu", issueId, anchor]),
    openPropertyPicker: (issueIds, field, anchor) =>
      calls.push(["openPropertyPicker", issueIds, field, anchor]),
    requestClose: record("requestClose"),
    openPalette: record("openPalette"),
    toggleBulkSelection: record("toggleBulkSelection"),
    clearBulkSelection: record("clearBulkSelection"),
    ...overrides,
  }
}

const onKeyDown = (event: Event) => handleBoardKey(event as KeyboardEvent, context)

beforeEach(() => {
  calls = []
  context = makeContext()
  document.addEventListener("keydown", onKeyDown)
})

afterEach(() => {
  document.removeEventListener("keydown", onKeyDown)
  document.body.innerHTML = ""
})

function press(
  target: Element | Document,
  key: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  }) as unknown as KeyboardEvent
  target.dispatchEvent(event)
  return event
}

function board(ids: string[]): HTMLElement[] {
  document.body.innerHTML = `<main id="board">${ids
    .map((id) => `<a href="/?id=${id}" data-id="${id}">${id}</a>`)
    .join("")}</main>`
  return [...document.querySelectorAll<HTMLElement>("#board [data-id]")]
}

describe("submitting with Cmd+Enter", () => {
  function issueView(): { issueForm: HTMLFormElement; commentForm: HTMLFormElement } {
    document.body.innerHTML = `
      <aside id="issue-view">
        <form id="issue-form"><textarea name="title"></textarea></form>
        <form id="comment-form" hidden></form>
        <textarea id="comment" form="comment-form"></textarea>
      </aside>`
    return {
      issueForm: document.getElementById("issue-form") as HTMLFormElement,
      commentForm: document.getElementById("comment-form") as HTMLFormElement,
    }
  }

  function submissions(form: HTMLFormElement): () => number {
    let count = 0
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      count++
    })
    return () => count
  }

  test("a field linked with the form attribute submits its own form, not the issue form", () => {
    const { issueForm, commentForm } = issueView()
    const issue = submissions(issueForm)
    const comment = submissions(commentForm)
    press(document.getElementById("comment")!, "Enter", { metaKey: true })
    expect(comment()).toBe(1)
    expect(issue()).toBe(0)
  })

  test("the issue form is submitted only when focus is inside it", () => {
    const { issueForm } = issueView()
    const issue = submissions(issueForm)
    press(document.body, "Enter", { metaKey: true })
    expect(issue()).toBe(0)
    press(issueForm.querySelector("textarea")!, "Enter", { ctrlKey: true })
    expect(issue()).toBe(1)
  })

  test("a field that already submitted itself is not submitted twice", () => {
    const { commentForm } = issueView()
    const comment = submissions(commentForm)
    const field = document.getElementById("comment")!
    field.addEventListener("keydown", (event) => event.preventDefault())
    press(field, "Enter", { metaKey: true })
    expect(comment()).toBe(0)
  })
})

describe("moving through the board", () => {
  test("j and k follow the order the rows appear on screen and wrap around", () => {
    board(["5", "3", "9"])
    press(document.body, "j")
    expect(calls).toEqual([["selectIssue", "5"]])
    calls = []
    context = makeContext({ selectedIssueId: "3" })
    press(document.body, "j")
    expect(calls).toEqual([["selectIssue", "9"]])
    calls = []
    context = makeContext({ selectedIssueId: "5" })
    press(document.body, "k")
    expect(calls).toEqual([["selectIssue", "9"]])
  })

  test("Enter opens the selected issue, but not when pressed on a link", () => {
    const rows = board(["5", "3"])
    context = makeContext({ selectedIssueId: "3" })
    press(document.body, "Enter")
    expect(calls).toEqual([["navigate", "/?id=3"]])
    calls = []
    press(rows[0]!, "Enter")
    expect(calls).toEqual([])
  })

  test("holding a key down does not repeat actions other than moving", () => {
    board(["5", "3"])
    context = makeContext({ selectedIssueId: "5" })
    for (const key of ["c", "x", "s"]) {
      document.body.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key,
          repeat: true,
          bubbles: true,
        }) as unknown as Event,
      )
    }
    expect(calls).toEqual([])
    document.body.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "j",
        repeat: true,
        bubbles: true,
      }) as unknown as Event,
    )
    expect(calls).toEqual([["selectIssue", "3"]])
  })

  test("c and n start a new issue from the board", () => {
    board(["5"])
    press(document.body, "c")
    press(document.body, "n")
    expect(calls).toEqual([
      ["navigate", "/?id=new"],
      ["navigate", "/?id=new"],
    ])
  })

  test("while the issue view is open, c, j, k, Enter and x leave the board alone", () => {
    board(["5", "3"])
    context = makeContext({ issueOpen: true, currentIssueId: "5", selectedIssueId: "3" })
    for (const key of ["c", "j", "k", "Enter", "x", "/"]) press(document.body, key)
    expect(calls).toEqual([])
  })
})

describe("closing with Escape", () => {
  test("Escape inside a field of the issue view leaves the field first, then closes", () => {
    document.body.innerHTML = `<aside id="issue-view"><textarea name="title"></textarea></aside>`
    context = makeContext({ issueOpen: true, currentIssueId: "5" })
    const title = document.querySelector<HTMLTextAreaElement>("textarea")!
    title.focus()
    press(title, "Escape")
    expect(calls).toEqual([])
    expect(document.activeElement).not.toBe(title)
    press(document.body, "Escape")
    expect(calls).toEqual([["requestClose"]])
  })

  test("Escape clears a bulk selection before anything else on the board", () => {
    board(["5"])
    context = makeContext({ bulkSelection: ["5"] })
    press(document.body, "Escape")
    expect(calls).toEqual([["clearBulkSelection"]])
  })

  test("keys are left to an open palette, dialog or menu", () => {
    board(["5"])
    context = makeContext({ overlayOpen: true, issueOpen: true, currentIssueId: "5" })
    press(document.body, "Escape")
    press(document.body, "k", { metaKey: true })
    press(document.body, "s")
    expect(calls).toEqual([])
  })
})

describe("menus and pickers from the keyboard", () => {
  test("Shift+F10 opens the menu of the focused row before the selected one", () => {
    const rows = board(["5", "3"])
    context = makeContext({ selectedIssueId: "3" })
    press(document.body, "F10", { shiftKey: true })
    expect(calls).toEqual([["openIssueMenu", "3", rows[1]]])
    calls = []
    rows[0]!.focus()
    press(rows[0]!, "ContextMenu")
    expect(calls).toEqual([["openIssueMenu", "5", rows[0]]])
  })

  test("s on the board changes the selected row, or every issue in the bulk selection", () => {
    const rows = board(["5", "3", "9"])
    context = makeContext({ selectedIssueId: "3" })
    press(document.body, "s")
    expect(calls).toEqual([["openPropertyPicker", ["3"], "status", rows[1]]])
    calls = []
    context = makeContext({ selectedIssueId: "3", bulkSelection: ["9", "5"] })
    press(document.body, "l")
    expect(calls).toEqual([["openPropertyPicker", ["9", "5"], "labels", rows[2]]])
  })

  test("in the issue view the key presses that property's own control, falling back to the picker", () => {
    document.body.innerHTML = `<aside id="issue-view"><textarea name="title"></textarea><div data-property="priority"><button type="button">Low</button></div><div data-property="dueDate"><input type="date" /></div></aside>`
    let clicked = 0
    document.querySelector("[data-property=priority] button")!.addEventListener("click", () => {
      clicked++
    })
    context = makeContext({ issueOpen: true, currentIssueId: "" })
    press(document.body, "p")
    expect(clicked).toBe(1)
    expect(calls).toEqual([])
    press(document.body, "d")
    expect(document.activeElement === document.querySelector("[data-property=dueDate] input")).toBe(
      true,
    )
    ;(document.activeElement as HTMLElement).blur()
    press(document.body, "s")
    expect(calls).toEqual([
      ["openPropertyPicker", [""], "status", document.querySelector("textarea")],
    ])
  })

  test("x toggles the selected row, and Cmd+K opens the palette even while typing", () => {
    board(["5"])
    context = makeContext({ selectedIssueId: "5" })
    press(document.body, "x")
    document.body.insertAdjacentHTML("beforeend", `<input id="q" />`)
    const search = document.getElementById("q")!
    const event = press(search, "k", { metaKey: true })
    expect(calls).toEqual([["toggleBulkSelection", "5"], ["openPalette"]])
    expect(event.defaultPrevented).toBe(true)
  })
})
