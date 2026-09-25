import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  issueUrl,
  notifyExpiringQuestions,
  notifyStaleIssues,
  questionUrl,
  readConfig,
} from "./notify"
import { getQuestion, saveQuestion } from "./questions"
import { init, saveIssue, type Store } from "./store"
import { registerWorkspace } from "./workspaces"

const dirs: string[] = []

function directory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(path)
  return path
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const NOW = new Date("2026-09-25T09:00:00.000Z")

// 通知コマンドが受け取った JSON を 1 行ずつ追記するワークスペースを作る
function workspace(state: string, name: string, config = "") {
  const root = join(directory("yaru-notify-"), name)
  mkdirSync(root)
  const store = init(root)
  registerWorkspace(root, state)
  const received = join(root, "received.jsonl")
  writeFileSync(
    join(store.dir, "config.yml"),
    `${config}notify: cat >> ${JSON.stringify(received)}; echo >> ${JSON.stringify(received)}\n`,
  )
  return { store, received }
}

function payloads(
  received: string,
): { event: string; url: string; question?: { id: string }; issue?: { id: string } }[] {
  if (!existsSync(received)) return []
  return readFileSync(received, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

describe("notify", () => {
  test("a question URL opens its card on the workspace dashboard", () => {
    expect(questionUrl("http://127.0.0.1:47800", "Asuka Travel", "3")).toBe(
      "http://127.0.0.1:47800/p/Asuka%20Travel/dashboard#q-3",
    )
  })

  test("config reads the notify command and a public URL for links opened on a phone", () => {
    const state = directory("yaru-notify-state-")
    const { store } = workspace(state, "app", "publicUrl: https://mac.example.ts.net/\n")
    expect(readConfig(store)).toMatchObject({ publicUrl: "https://mac.example.ts.net" })
    writeFileSync(join(store.dir, "config.yml"), "")
    expect(readConfig(store)).toEqual({ notify: null, publicUrl: null })
  })

  test("questions about to expire are notified once per question across workspaces", async () => {
    const state = directory("yaru-notify-state-")
    const first = workspace(state, "first")
    const second = workspace(state, "second", "publicUrl: https://mac.example.ts.net\n")
    saveQuestion(first.store, { title: "soon", defaultAction: "x", answerBy: "1h" }, NOW)
    saveQuestion(first.store, { title: "later", defaultAction: "x", answerBy: "3h" }, NOW)
    saveQuestion(second.store, { title: "soon too", answerBy: "1h" }, NOW)
    const now = new Date("2026-09-25T09:50:00.000Z")
    const warnings = await notifyExpiringQuestions(state, now, "http://127.0.0.1:47800")
    expect(warnings).toEqual([])
    expect(payloads(first.received)).toEqual([
      expect.objectContaining({
        event: "question.expiring",
        url: "http://127.0.0.1:47800/p/first/dashboard#q-1",
        question: expect.objectContaining({ id: "1" }),
      }),
    ])
    expect(payloads(second.received)).toEqual([
      expect.objectContaining({
        event: "question.expiring",
        url: "https://mac.example.ts.net/p/second/dashboard#q-1",
      }),
    ])
    expect(getQuestion(first.store, "1", now).notifiedExpiringAt).toBe(now.toISOString())
    await notifyExpiringQuestions(state, new Date("2026-09-25T09:51:00.000Z"), "http://x")
    expect(payloads(first.received)).toHaveLength(1)
  })

  test("without a notify command nothing is recorded", async () => {
    const state = directory("yaru-notify-state-")
    const root = join(directory("yaru-notify-"), "quiet")
    mkdirSync(root)
    const store: Store = init(root)
    registerWorkspace(root, state)
    saveQuestion(store, { title: "soon", answerBy: "1h" }, NOW)
    const now = new Date("2026-09-25T09:50:00.000Z")
    expect(await notifyExpiringQuestions(state, now, "http://x")).toEqual([])
    expect(getQuestion(store, "1", now).notifiedExpiringAt).toBeNull()
  })

  test("a failing command is reported as a warning naming the workspace and question", async () => {
    const state = directory("yaru-notify-state-")
    const { store } = workspace(state, "broken")
    writeFileSync(join(store.dir, "config.yml"), "notify: echo boom >&2; exit 3\n")
    saveQuestion(store, { title: "soon", answerBy: "1h" }, NOW)
    const warnings = await notifyExpiringQuestions(
      state,
      new Date("2026-09-25T09:50:00.000Z"),
      "http://x",
    )
    expect(warnings).toEqual([
      "broken question 1: notify command failed: expected exit code 0, actual 3: boom",
    ])
  })

  test("an issue URL opens it on the workspace board", () => {
    expect(issueUrl("https://mac.example.ts.net/", "app", "7")).toBe(
      "https://mac.example.ts.net/p/app/?id=7",
    )
  })

  test("stale issues are notified once until they are updated and go stale again", async () => {
    const state = directory("yaru-notify-state-")
    const { store, received } = workspace(state, "stale", "staleAfter: 1h\n")
    const stuck = saveIssue(store, { title: "stuck", status: "in_progress" })
    saveIssue(store, { title: "todo" })
    const later = new Date(Date.parse(stuck.updatedAt) + 2 * 3_600_000)
    expect(await notifyStaleIssues(state, later, "http://127.0.0.1:47800")).toEqual([])
    expect(payloads(received)).toEqual([
      expect.objectContaining({
        event: "issue.stale",
        url: "http://127.0.0.1:47800/p/stale/?id=1",
        issue: expect.objectContaining({ id: "1", stale: true }),
      }),
    ])
    await notifyStaleIssues(state, new Date(later.getTime() + 60_000), "http://x")
    expect(payloads(received)).toHaveLength(1)
    const touched = saveIssue(store, { id: "1", title: "stuck again" })
    await notifyStaleIssues(
      state,
      new Date(Date.parse(touched.updatedAt) + 2 * 3_600_000),
      "http://x",
    )
    expect(payloads(received)).toHaveLength(2)
  })
})
