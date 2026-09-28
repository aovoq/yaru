import { expect, test } from "vitest"
import { renderToString } from "preact-render-to-string"
import { BoardScreen } from "../app/board-screen"
import type { BoardApi } from "../board/board-api"
import { BLANK, type PageData } from "../board/page-data"
import type { Issue } from "../domain/issue"
import type { BoardQuery } from "../route"

// 板が開いている issue は、空の枠ではなく題名の欄まで描く

const issue: Issue = {
  ...BLANK,
  id: "1",
  title: "地図の配色",
  body: "本文",
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
}

test("an open issue on the board shows the issue title field", () => {
  const html = renderToString(
    <BoardScreen
      slug="app"
      query={emptyQuery()}
      fragment={null}
      api={idleApi()}
      initialPage={page(issue)}
    />,
  )
  expect(html).toContain('aria-label="Issue title"')
  expect(html).toContain("地図の配色")
  expect(html).toContain('id="issue-view"')
})

function emptyQuery(): BoardQuery {
  return {
    query: null,
    id: null,
    status: null,
    assignee: null,
    label: null,
    awaiting: null,
    sort: null,
    group: null,
    completed: null,
    view: null,
    newStatus: null,
    newParent: null,
    newLabel: null,
    newAssignee: null,
    error: null,
    comment: null,
    questionId: null,
    answer: null,
  }
}

function page(current: Issue): PageData {
  return {
    issues: [current],
    all: [current],
    query: "",
    current,
    comments: [],
    events: [],
    commits: [],
    awaiting: false,
    awaitingByIssue: {},
    display: { sort: "priority", group: "status", completed: "recent" },
    view: "list",
    basePath: "/p/app",
    awaitingQuestionCount: 0,
    viewer: "aovoq",
    now: "2026-09-28T12:00:00.000Z",
  }
}

function idleApi(): BoardApi {
  return {
    loadPage: async () => {
      throw new Error("unused loadPage")
    },
    saveIssue: async () => {
      throw new Error("unused saveIssue")
    },
    loadWorkspaces: async () => [],
    subscribe: async () => {},
  }
}
