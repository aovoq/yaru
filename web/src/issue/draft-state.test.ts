import { expect, test } from "vitest"
import {
  createClientState,
  hasUnsavedChanges,
  reduceClientState,
  unsavedChanges,
} from "./draft-state"
import { BLANK_ISSUE, type IssuePage } from "./model"

function page(title: string, id = "1"): IssuePage {
  const issue = {
    ...BLANK_ISSUE,
    id,
    title,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  }
  return {
    issues: [issue],
    all: [issue],
    query: "",
    current: issue,
    comments: [],
    questions: [],
    events: [],
    commits: [],
    awaiting: false,
    display: { sort: "priority", group: "status", completed: "recent" },
    view: "list",
    basePath: "/p/demo",
    viewer: "aovoq",
    now: "2020-01-15T00:00:00.000Z",
  }
}

test("a rejected field returns to the saved value and keeps the other draft", () => {
  let state = createClientState(page("topic"))
  state = reduceClientState(state, { type: "draftChanged", field: "labels", value: "a, b" })
  state = reduceClientState(state, { type: "draftChanged", field: "body", value: "typing" })
  state = reduceClientState(state, { type: "fieldReverted", field: "labels" })
  expect(state.current?.labels).toEqual([])
  expect(state.current?.body).toBe("typing")
  expect(state.draftDirty).toBe(true)
  expect(state.saveState).toBe("idle")
  expect(state.requestError).toBeUndefined()
})

test("a rejected create keeps the draft and does not become a failed save", () => {
  let state = createClientState({ ...page("topic"), current: { ...BLANK_ISSUE, title: "Hello" } })
  state = reduceClientState(state, { type: "saveRejected", message: "title is required" })
  expect(state.saveState).toBe("idle")
  expect(state.requestError).toBe("title is required")
  expect(state.current?.title).toBe("Hello")
})

test("an existing issue is unsaved only while a draft is dirty and not being saved", () => {
  const initial = createClientState(page("topic"))
  expect(hasUnsavedChanges(initial)).toBe(false)
  const edited = reduceClientState(initial, { type: "draftChanged", field: "title", value: "x" })
  expect(hasUnsavedChanges(edited)).toBe(true)
  expect(hasUnsavedChanges(reduceClientState(edited, { type: "saveStarted" }))).toBe(false)
  expect(
    hasUnsavedChanges(reduceClientState(edited, { type: "saveFailed", message: "boom" })),
  ).toBe(true)
})

test("a new issue is unsaved once it has a title or a description", () => {
  const blank = createClientState({ ...page("topic"), current: { ...BLANK_ISSUE } })
  expect(hasUnsavedChanges(blank)).toBe(false)
  const status = reduceClientState(blank, { type: "draftChanged", field: "status", value: "done" })
  expect(hasUnsavedChanges(status)).toBe(false)
  expect(
    hasUnsavedChanges(reduceClientState(blank, { type: "draftChanged", field: "title", value: " a " })),
  ).toBe(true)
  expect(
    hasUnsavedChanges(reduceClientState(blank, { type: "draftChanged", field: "body", value: "b" })),
  ).toBe(true)
})

test("retry sends only the fields that differ, ignoring title whitespace", () => {
  const saved = { ...BLANK_ISSUE, id: "1", title: "topic", labels: ["a"], priority: "high" as const }
  expect(unsavedChanges(saved, saved)).toEqual({})
  expect(
    unsavedChanges(
      { ...saved, title: "topic ", labels: ["a", "b"], priority: null, body: "x" },
      saved,
    ),
  ).toEqual({ labels: ["a", "b"], priority: null, body: "x" })
})

test("a reload keeps a field that is still being typed and drops it when the server caught up", () => {
  const initial = createClientState(page("topic"), { comment: "hello" })
  const typing = reduceClientState(initial, { type: "draftChanged", field: "title", value: "typing" })
  const refreshed = reduceClientState(typing, {
    type: "pageLoaded",
    page: page("topic"),
    preserveDraft: true,
  })
  expect(refreshed.current?.title).toBe("typing")
  expect(refreshed.draftDirty).toBe(true)
  expect(refreshed.returnedDrafts).toEqual({ comment: "hello" })
  const caughtUp = reduceClientState(refreshed, {
    type: "pageLoaded",
    page: page("typing"),
    preserveDraft: true,
  })
  expect(caughtUp.draftDirty).toBe(false)
  expect(caughtUp.current?.title).toBe("typing")
})

test("opening another issue drops the previous draft and the returned text", () => {
  const initial = createClientState(page("topic"), { comment: "hello" })
  const next = reduceClientState(initial, {
    type: "pageLoaded",
    page: page("other", "2"),
    preserveDraft: false,
  })
  expect(next.current?.id).toBe("2")
  expect(next.returnedDrafts).toEqual({})
  expect(next.saveState).toBe("idle")
})
