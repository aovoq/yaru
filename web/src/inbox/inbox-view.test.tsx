import { renderToString } from "preact-render-to-string"
import { expect, test } from "vitest"
import type { Question } from "../domain/question"
import { InboxView, type InboxItem } from "./inbox-view"

const NOW = new Date("2026-09-28T12:00:00.000Z")

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "1",
    title: "先に答える",
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
    createdAt: "2026-09-28T10:00:00.000Z",
    updatedAt: "2026-09-28T10:00:00.000Z",
    body: "本文",
    ...overrides,
  }
}

function item(workspace: string, overrides: Partial<Question> = {}): InboxItem {
  const asked = question(overrides)
  return {
    workspace,
    basePath: `/p/${workspace}`,
    href: `/p/${workspace}/dashboard#q-${asked.id}`,
    anchor: `q-${workspace}-${asked.id}`,
    question: asked,
  }
}

const empty = { blocking: [], dueSoon: [], noDeadline: [], proceeded: [] }

test("the inbox mixes workspaces into the same urgency groups", () => {
  const html = renderToString(
    <InboxView
      now={NOW}
      inbox={{
        groups: {
          ...empty,
          blocking: [item("app", { id: "1", title: "止まっている" })],
          proceeded: [
            item("other", {
              id: "2",
              title: "進んだ",
              status: "expired",
              defaultAction: "残す",
            }),
          ],
        },
        workspaces: [],
      }}
    />,
  )
  expect(html).toContain("Inbox")
  expect(html).toContain("止まっている")
  expect(html).toContain("app")
  expect(html).toContain('action="/p/app/questions/1/answer"')
  expect(html).toContain('name="returnTo" value="/inbox"')
  expect(html).not.toContain("No questions awaiting an answer in any workspace")
  expect(html).toContain('data-awaiting-ids="q-app-1 q-other-2"')
})

test("an inbox error without a card is shown at the top", () => {
  const html = renderToString(
    <InboxView
      now={NOW}
      inbox={{ groups: empty, workspaces: [] }}
      returned={{ workspace: "app", question: "9", error: "question not found: 9" }}
    />,
  )
  expect(html).toContain("question not found: 9")
})

test("the inbox is empty when no workspace is waiting", () => {
  const html = renderToString(<InboxView now={NOW} inbox={{ groups: empty, workspaces: [] }} />)
  expect(html).toContain("No questions awaiting an answer in any workspace")
})
