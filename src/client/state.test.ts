import { describe, expect, test } from "bun:test"
import { BLANK, type PageData } from "../page"
import { createClientState, reduceClientState } from "./state"

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
})
