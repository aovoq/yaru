import { renderToString } from "preact-render-to-string"
import { expect, test } from "vitest"
import type { Question } from "../domain/question"
import { ProjectsView } from "./projects-view"

const NOW = new Date("2026-09-28T12:00:00.000Z")

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "3",
    title: "色を決める",
    status: "open",
    issue: null,
    priority: null,
    defaultAction: null,
    answerBy: "2026-09-28T13:00:00.000Z",
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
    createdAt: "2026-09-28T10:00:00.000Z",
    updatedAt: "2026-09-28T10:00:00.000Z",
    body: "",
    ...overrides,
  }
}

test("an empty registry tells the reader to run yaru", () => {
  const html = renderToString(<ProjectsView projects={[]} now={NOW} />)
  expect(html).toContain("No workspaces yet. Run yaru in a workspace to add it here.")
  expect(html).not.toContain('href="/inbox"')
})

test("a project card counts awaiting questions and links to the board and the dashboard", () => {
  const html = renderToString(
    <ProjectsView
      now={NOW}
      projects={[
        {
          slug: "app",
          root: "/tmp/app",
          awaiting: [question()],
          inProgress: 2,
        },
      ]}
    />,
  )
  expect(html).toContain("Inbox")
  expect(html).toContain("Every workspace's questions, most urgent first")
  expect(html).toContain("1 awaiting")
  expect(html).toContain("2 in progress")
  expect(html).toContain("/tmp/app")
  expect(html).toContain('href="/p/app/"')
  expect(html).toContain('href="/p/app/dashboard"')
  expect(html).toContain('href="/p/app/dashboard#q-3"')
  expect(html).toContain("色を決める")
  expect(html).toContain("Blocking")
})
