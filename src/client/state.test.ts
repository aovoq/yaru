import { describe, expect, test } from "bun:test"
import { BLANK, type PageData } from "../page"
import { createClientState, fieldChange, reduceClientState } from "./state"

function page(title: string): PageData {
  const issue = { ...BLANK, id: "1", title }
  return {
    issues: [issue],
    all: [issue],
    query: "",
    current: issue,
    comments: [],
    view: "list",
  }
}

describe("client state", () => {
  test("refresh preserves a dirty draft", () => {
    const initial = createClientState(page("before"))
    const edited = reduceClientState(initial, {
      type: "draftChanged",
      field: "title",
      value: "local edit",
    })
    const refreshed = reduceClientState(edited, {
      type: "pageLoaded",
      page: page("from disk"),
      preserveDraft: true,
    })
    expect(refreshed.current?.title).toBe("local edit")
    expect(refreshed.issues[0]?.title).toBe("from disk")
  })

  test("navigation replaces the current draft", () => {
    const edited = reduceClientState(createClientState(page("before")), {
      type: "draftChanged",
      field: "title",
      value: "local edit",
    })
    const navigated = reduceClientState(edited, {
      type: "pageLoaded",
      page: page("next issue"),
      preserveDraft: false,
    })
    expect(navigated.current?.title).toBe("next issue")
    expect(navigated.draftDirty).toBe(false)
  })

  test("label editing preserves the input text and updates parsed labels", () => {
    const edited = reduceClientState(createClientState(page("issue")), {
      type: "draftChanged",
      field: "labels",
      value: "bug, next ",
    })
    expect(edited.labelInput).toBe("bug, next ")
    expect(edited.current?.labels).toEqual(["bug", "next"])
  })

  test("the last loaded issue is kept as the saved version even while a draft is preserved", () => {
    const edited = reduceClientState(createClientState(page("before")), {
      type: "draftChanged",
      field: "title",
      value: "local edit",
    })
    const refreshed = reduceClientState(edited, {
      type: "pageLoaded",
      page: page("from disk"),
      preserveDraft: true,
    })
    expect(refreshed.current?.title).toBe("local edit")
    expect(refreshed.saved?.title).toBe("from disk")
  })

  test("autosave reports saving, then saved, and a failure returns to idle with the error", () => {
    const initial = createClientState(page("t"))
    expect(initial.saveState).toBe("idle")
    const saving = reduceClientState(initial, { type: "saveStarted" })
    expect(saving.saveState).toBe("saving")
    const saved = reduceClientState(saving, { type: "saveFinished" })
    expect(saved.saveState).toBe("saved")
    const refreshed = reduceClientState(saved, {
      type: "pageLoaded",
      page: page("t"),
      preserveDraft: true,
    })
    expect(refreshed.saveState).toBe("saved")
    const failed = reduceClientState(saving, { type: "requestFailed", message: "boom" })
    expect(failed.saveState).toBe("idle")
    expect(failed.requestError).toBe("boom")
  })
})

describe("autosave refresh", () => {
  test("typing in another field while a save is in flight survives the refresh", () => {
    let state = createClientState(page("before"))
    state = reduceClientState(state, { type: "draftChanged", field: "title", value: "after" })
    state = reduceClientState(state, { type: "saveStarted" })
    state = reduceClientState(state, { type: "draftChanged", field: "body", value: "typing" })
    state = reduceClientState(state, { type: "saveFinished" })
    const server = page("after")
    state = reduceClientState(state, { type: "pageLoaded", page: server, preserveDraft: true })
    expect(state.current?.body).toBe("typing")
    expect(state.current?.title).toBe("after")
    expect(state.draftDirty).toBe(true)
  })

  test("a refresh that matches the draft clears the unsaved mark", () => {
    let state = createClientState(page("before"))
    state = reduceClientState(state, { type: "draftChanged", field: "title", value: "after " })
    state = reduceClientState(state, { type: "saveFinished" })
    state = reduceClientState(state, {
      type: "pageLoaded",
      page: page("after"),
      preserveDraft: true,
    })
    expect(state.draftDirty).toBe(false)
    expect(state.current?.title).toBe("after")
  })
})

describe("field change", () => {
  const saved = {
    ...BLANK,
    id: "1",
    title: "t",
    labels: ["a", "b"],
    assignee: "me",
    priority: "high" as const,
  }

  test("an unchanged value needs no save", () => {
    expect(fieldChange(saved, "title", "t")).toBeNull()
    expect(fieldChange(saved, "labels", "a,  b")).toBeNull()
    expect(fieldChange(saved, "assignee", "me")).toBeNull()
  })

  test("a changed value becomes the matching save input", () => {
    expect(fieldChange(saved, "title", "new")).toEqual({ title: "new" })
    expect(fieldChange(saved, "labels", "a, c")).toEqual({ labels: ["a", "c"] })
    expect(fieldChange(saved, "blocks", "2, 3")).toEqual({ blocks: ["2", "3"] })
    expect(fieldChange(saved, "assignee", "")).toEqual({ assignee: null })
    expect(fieldChange(saved, "priority", "")).toEqual({ priority: null })
    expect(fieldChange(saved, "status", "done")).toEqual({ status: "done" })
    expect(fieldChange(saved, "body", "x")).toEqual({ body: "x" })
  })
})
