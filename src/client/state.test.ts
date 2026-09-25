import { describe, expect, test } from "bun:test"
import { BLANK, type PageData } from "../page"
import {
  createClientState,
  documentTitle,
  fieldChange,
  hasUnsavedChanges,
  readReturnedDrafts,
  reduceClientState,
  unsavedChanges,
  withoutReturnedParams,
} from "./state"

function page(title: string, id = "1"): PageData {
  const issue = { ...BLANK, id, title }
  return {
    issues: [issue],
    all: [issue],
    query: "",
    current: issue,
    comments: [],
    view: "list",
    events: [],
    commits: [],
    awaiting: false,
    awaitingByIssue: {},
    display: { sort: "priority", group: "status", completed: "recent" },
    viewer: "aovoq",
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
    const failed = reduceClientState(saving, { type: "saveFailed", message: "boom" })
    expect(failed.saveState).toBe("failed")
    expect(failed.requestError).toBe("boom")
  })

  test("a failed page load keeps the save indicator of the open issue", () => {
    const saving = reduceClientState(createClientState(page("t")), { type: "saveStarted" })
    const failed = reduceClientState(saving, { type: "requestFailed", message: "offline" })
    expect(failed.saveState).toBe("saving")
    expect(failed.requestError).toBe("offline")
  })

  test("Saved fades back to idle, but a later save in flight is not hidden", () => {
    const saved = reduceClientState(createClientState(page("t")), { type: "saveFinished" })
    expect(reduceClientState(saved, { type: "saveFaded" }).saveState).toBe("idle")
    const saving = reduceClientState(saved, { type: "saveStarted" })
    expect(reduceClientState(saving, { type: "saveFaded" }).saveState).toBe("saving")
  })

  test("opening another issue resets the save indicator", () => {
    const saved = reduceClientState(createClientState(page("t")), { type: "saveFinished" })
    const other = reduceClientState(saved, {
      type: "pageLoaded",
      page: page("other", "2"),
      preserveDraft: false,
    })
    expect(other.saveState).toBe("idle")
    const failed = reduceClientState(createClientState(page("t")), {
      type: "saveFailed",
      message: "boom",
    })
    const closed = reduceClientState(failed, {
      type: "pageLoaded",
      page: { ...page("t"), current: null },
      preserveDraft: false,
    })
    expect(closed.saveState).toBe("idle")
  })

  test("a failed save stays failed across refreshes of the same issue until a save succeeds", () => {
    let state = createClientState(page("before"))
    state = reduceClientState(state, { type: "draftChanged", field: "title", value: "after" })
    state = reduceClientState(state, { type: "saveFailed", message: "offline" })
    state = reduceClientState(state, {
      type: "pageLoaded",
      page: page("before"),
      preserveDraft: true,
    })
    expect(state.saveState).toBe("failed")
    expect(state.draftDirty).toBe(true)
    expect(state.current?.title).toBe("after")
  })

  test("only a failed page load offers to load again", () => {
    const initial = createClientState(page("t"))
    const loadFailed = reduceClientState(initial, {
      type: "requestFailed",
      message: "Failed to fetch",
      retryable: true,
    })
    expect(loadFailed.requestRetryable).toBe(true)
    const rejected = reduceClientState(loadFailed, {
      type: "requestFailed",
      message: "unknown status: expected one of todo, actual x",
    })
    expect(rejected.requestRetryable).toBe(false)
    const reloaded = reduceClientState(loadFailed, {
      type: "pageLoaded",
      page: page("t"),
      preserveDraft: true,
    })
    expect(reloaded.requestRetryable).toBe(false)
    expect(reduceClientState(loadFailed, { type: "errorDismissed" }).requestRetryable).toBe(false)
  })

  test("an error can be dismissed", () => {
    const withError = createClientState({
      ...page("t"),
      current: null,
      error: "issue not found: 9",
    })
    const failed = reduceClientState(withError, { type: "requestFailed", message: "offline" })
    const dismissed = reduceClientState(failed, { type: "errorDismissed" })
    expect(dismissed.error).toBeUndefined()
    expect(dismissed.requestError).toBeUndefined()
  })
})

describe("rejected saves", () => {
  test("a field the server rejects goes back to the saved value without a global error", () => {
    let state = createClientState({
      ...page("t"),
      current: { ...BLANK, id: "1", title: "t", labels: ["a"], dueDate: "2026-10-01" },
    })
    state = reduceClientState(state, { type: "draftChanged", field: "labels", value: "a, b" })
    state = reduceClientState(state, { type: "draftChanged", field: "body", value: "typing" })
    state = reduceClientState(state, { type: "saveStarted" })
    state = reduceClientState(state, { type: "fieldReverted", field: "labels" })
    expect(state.current?.labels).toEqual(["a"])
    expect(state.labelInput).toBe("a")
    expect(state.current?.body).toBe("typing")
    expect(state.draftDirty).toBe(true)
    expect(state.saveState).toBe("idle")
    expect(state.requestError).toBeUndefined()
    state = reduceClientState(state, { type: "fieldReverted", field: "body" })
    expect(state.draftDirty).toBe(false)
  })

  test("a rejected create keeps the draft and shows why, without the failed-save retry", () => {
    let state = createClientState({ ...page("t"), current: { ...BLANK, title: "" } })
    state = reduceClientState(state, { type: "saveStarted" })
    state = reduceClientState(state, { type: "saveRejected", message: "title is required" })
    expect(state.saveState).toBe("idle")
    expect(state.requestError).toBe("title is required")
  })
})

describe("unsaved changes", () => {
  test("an existing issue has unsaved changes only while a draft is dirty and not being saved", () => {
    const initial = createClientState(page("t"))
    expect(hasUnsavedChanges(initial)).toBe(false)
    const edited = reduceClientState(initial, {
      type: "draftChanged",
      field: "title",
      value: "x",
    })
    expect(hasUnsavedChanges(edited)).toBe(true)
    expect(hasUnsavedChanges(reduceClientState(edited, { type: "saveStarted" }))).toBe(false)
    expect(
      hasUnsavedChanges(reduceClientState(edited, { type: "saveFailed", message: "boom" })),
    ).toBe(true)
  })

  test("a new issue has unsaved changes once it has a title or a description", () => {
    const blank = createClientState({ ...page("t"), current: { ...BLANK } })
    expect(hasUnsavedChanges(blank)).toBe(false)
    const status = reduceClientState(blank, {
      type: "draftChanged",
      field: "status",
      value: "done",
    })
    expect(hasUnsavedChanges(status)).toBe(false)
    const titled = reduceClientState(blank, { type: "draftChanged", field: "title", value: " a " })
    expect(hasUnsavedChanges(titled)).toBe(true)
    const described = reduceClientState(blank, { type: "draftChanged", field: "body", value: "b" })
    expect(hasUnsavedChanges(described)).toBe(true)
    expect(hasUnsavedChanges({ ...blank, current: null })).toBe(false)
  })

  test("the fields that differ from the saved issue become one save input for a retry", () => {
    const saved = { ...BLANK, id: "1", title: "t", labels: ["a"], priority: "high" as const }
    expect(unsavedChanges(saved, saved)).toEqual({})
    expect(
      unsavedChanges(
        { ...saved, title: "t ", labels: ["a", "b"], priority: null, body: "x" },
        saved,
      ),
    ).toEqual({ labels: ["a", "b"], priority: null, body: "x" })
  })
})

describe("returned drafts", () => {
  test("a failed comment or answer brings back the text and the question it was for", () => {
    expect(readReturnedDrafts("?id=3&error=boom&comment=hello")).toEqual({ comment: "hello" })
    expect(readReturnedDrafts("?id=3&error=boom&q=8&answer=yes")).toEqual({
      answer: { questionId: "8", text: "yes" },
    })
    expect(readReturnedDrafts("?id=3&error=boom")).toEqual({})
    expect(readReturnedDrafts("?q=8")).toEqual({})
  })

  test("the returned parameters are dropped from the address, keeping the rest and the anchor", () => {
    expect(
      withoutReturnedParams("http://host/p/a/?id=3&error=boom&q=8&answer=yes&query=x#q-8"),
    ).toBe("http://host/p/a/?id=3&query=x#q-8")
    expect(withoutReturnedParams("http://host/p/a/?id=3")).toBeNull()
  })

  test("the drafts are kept while the same issue stays open and dropped when another opens", () => {
    const initial = createClientState(page("t"), { comment: "hello" })
    expect(initial.returnedDrafts).toEqual({ comment: "hello" })
    const refreshed = reduceClientState(initial, {
      type: "pageLoaded",
      page: page("t"),
      preserveDraft: true,
    })
    expect(refreshed.returnedDrafts).toEqual({ comment: "hello" })
    const other = reduceClientState(refreshed, {
      type: "pageLoaded",
      page: page("u", "2"),
      preserveDraft: false,
    })
    expect(other.returnedDrafts).toEqual({})
  })
})

describe("bulk selection", () => {
  const ids = ["5", "4", "3", "2", "1"]
  function listPage(): PageData {
    const issues = ids.map((id) => ({ ...BLANK, id, title: id }))
    return { ...page("t"), issues, all: issues, current: null }
  }

  test("x toggles one issue and a range extends from the last toggled issue in board order", () => {
    let state = createClientState(listPage())
    state = reduceClientState(state, { type: "bulkToggled", issueId: "4" })
    expect(state.bulkSelection).toEqual(["4"])
    state = reduceClientState(state, { type: "bulkRangeSelected", issueId: "2", orderedIds: ids })
    expect(state.bulkSelection).toEqual(["4", "3", "2"])
    state = reduceClientState(state, { type: "bulkToggled", issueId: "3" })
    expect(state.bulkSelection).toEqual(["4", "2"])
    state = reduceClientState(state, { type: "bulkCleared" })
    expect(state.bulkSelection).toEqual([])
  })

  test("a range without an earlier toggle selects just that issue, and upward ranges work", () => {
    let state = createClientState(listPage())
    state = reduceClientState(state, { type: "bulkRangeSelected", issueId: "3", orderedIds: ids })
    expect(state.bulkSelection).toEqual(["3"])
    state = reduceClientState(state, { type: "bulkRangeSelected", issueId: "5", orderedIds: ids })
    expect(state.bulkSelection).toEqual(["3", "5", "4"])
  })

  test("issues that disappear after a refresh leave the selection", () => {
    let state = createClientState(listPage())
    state = reduceClientState(state, { type: "bulkToggled", issueId: "4" })
    state = reduceClientState(state, { type: "bulkToggled", issueId: "2" })
    const remaining = listPage()
    remaining.all = remaining.all.filter((issue) => issue.id !== "2")
    state = reduceClientState(state, { type: "pageLoaded", page: remaining, preserveDraft: true })
    expect(state.bulkSelection).toEqual(["4"])
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

describe("document title", () => {
  test("names the open issue and the workspace like the server does", () => {
    const issue = { ...BLANK, id: "73", title: "称号を片付ける" }
    expect(documentTitle(issue, "/p/yaru-demo")).toBe("#73 称号を片付ける · yaru-demo · yaru")
    expect(documentTitle(null, "/p/yaru-demo")).toBe("yaru-demo · yaru")
    expect(documentTitle({ ...BLANK }, "/p/yaru-demo")).toBe("New issue · yaru-demo · yaru")
    expect(documentTitle(issue, "")).toBe("#73 称号を片付ける · yaru")
    expect(documentTitle(null, "/p/a%20b")).toBe("a b · yaru")
  })
})
