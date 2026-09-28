import { describe, expect, test } from "vitest"
import {
  cardFragment,
  matchPath,
  readBoardQuery,
  readDashboardQuery,
  readInboxQuery,
} from "./route"

// docs/spec/routes.md の「SPA が受け取る path」
describe("matchPath", () => {
  test("maps the four screens and treats every other path as not found", () => {
    expect(matchPath("/")).toEqual({ name: "projects" })
    expect(matchPath("/inbox")).toEqual({ name: "inbox" })
    expect(matchPath("/p/app/")).toEqual({
      name: "board",
      slug: "app",
      registration: "pending",
    })
    expect(matchPath("/p/app/dashboard")).toEqual({
      name: "dashboard",
      slug: "app",
      registration: "pending",
    })
    for (const pathname of [
      "/inbox/",
      "/nope",
      "/p",
      "/p/",
      "/p/app/dashboard/",
      "/p/app/issues",
      "/p/app/events",
      "/assets/app.js",
    ]) {
      expect(matchPath(pathname)).toEqual({ name: "not-found" })
    }
  })

  test("opens /p/:slug without a trailing slash as the board and does not redirect", () => {
    expect(matchPath("/p/app")).toEqual({
      name: "board",
      slug: "app",
      registration: "pending",
    })
    expect(matchPath("/p/app")).not.toHaveProperty("redirect")
  })

  test("a slug missing from the registry is not found, including the board and dashboard", () => {
    const knownSlugs = new Set(["app"])
    expect(matchPath("/p/missing", knownSlugs)).toEqual({ name: "not-found" })
    expect(matchPath("/p/missing/", knownSlugs)).toEqual({ name: "not-found" })
    expect(matchPath("/p/missing/dashboard", knownSlugs)).toEqual({ name: "not-found" })
    expect(matchPath("/p/app", knownSlugs)).toEqual({
      name: "board",
      slug: "app",
      registration: "known",
    })
    expect(matchPath("/p/app/", knownSlugs)).toEqual({
      name: "board",
      slug: "app",
      registration: "known",
    })
    expect(matchPath("/p/app/dashboard", knownSlugs)).toEqual({
      name: "dashboard",
      slug: "app",
      registration: "known",
    })
  })

  test("decodes the slug and rejects an empty slug or one that contains a slash", () => {
    expect(matchPath("/p/app.v2/")).toMatchObject({ name: "board", slug: "app.v2" })
    expect(matchPath("/p/a%2Fb/")).toEqual({ name: "not-found" })
    expect(matchPath("/p/%2e%2e/")).toEqual({ name: "not-found" })
    expect(matchPath("/p/%2e/")).toEqual({ name: "not-found" })
  })
})

describe("query and fragment", () => {
  test("reads the inbox query names", () => {
    expect(readInboxQuery("?workspace=app&q=1&error=e&answer=a&answered=2")).toEqual({
      workspace: "app",
      questionId: "1",
      error: "e",
      answer: "a",
      answered: "2",
    })
    expect(readInboxQuery("")).toEqual({
      workspace: null,
      questionId: null,
      error: null,
      answer: null,
      answered: null,
    })
  })

  test("reads the dashboard query names and ignores workspace", () => {
    expect(readDashboardQuery("?q=3&error=e&answer=a&answered=3&workspace=other")).toEqual({
      questionId: "3",
      error: "e",
      answer: "a",
      answered: "3",
    })
  })

  test("reads the board query, including drafts that are not part of PageData", () => {
    expect(
      readBoardQuery(
        "?query=ship&id=12&status=todo&assignee=me&label=bug&awaiting=1&sort=due&group=none&completed=all&view=board&new_status=todo&new_parent=1&new_label=bug&new_assignee=none&error=e&comment=c&q=4&answer=draft",
      ),
    ).toEqual({
      query: "ship",
      id: "12",
      status: "todo",
      assignee: "me",
      label: "bug",
      awaiting: "1",
      sort: "due",
      group: "none",
      completed: "all",
      view: "board",
      newStatus: "todo",
      newParent: "1",
      newLabel: "bug",
      newAssignee: "none",
      error: "e",
      comment: "c",
      questionId: "4",
      answer: "draft",
    })
  })

  test("keeps a fragment only when it matches the server pattern", () => {
    expect(cardFragment("#q-1")).toBe("q-1")
    expect(cardFragment("#q-app-1")).toBe("q-app-1")
    expect(cardFragment("#proceeded")).toBe("proceeded")
    expect(cardFragment("#12")).toBeNull()
    expect(cardFragment("#")).toBeNull()
    expect(cardFragment("#has space")).toBeNull()
    expect(cardFragment("q-1")).toBe("q-1")
  })
})
