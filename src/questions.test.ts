import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  answerQuestion,
  getQuestion,
  listQuestions,
  saveQuestion,
  QUESTION_ANSWER_MARKER,
} from "./questions"
import { init, saveIssue } from "./store"

const dirs: string[] = []

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-questions-"))
  dirs.push(root)
  return init(root)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const NOW = new Date("2026-09-25T09:00:00.000Z")

describe("questions", () => {
  test("create stores the question as markdown and reads it back as open", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    const created = saveQuestion(
      store,
      {
        title: "本番 DB の称号を消すか",
        issue: "1",
        priority: "high",
        defaultAction: "消さずに残す",
        answerBy: "2h",
        body: "背景の説明",
      },
      NOW,
    )
    expect(created).toMatchObject({
      id: "1",
      title: "本番 DB の称号を消すか",
      status: "open",
      issue: "1",
      priority: "high",
      defaultAction: "消さずに残す",
      answerBy: "2026-09-25T11:00:00.000Z",
      answer: null,
      answeredBy: null,
      answeredAt: null,
      canceledAt: null,
      createdAt: NOW.toISOString(),
      body: "背景の説明",
    })
    expect(created.author).toBeTruthy()
    const text = readFileSync(join(store.dir, "questions", "1.md"), "utf8")
    expect(text).toContain("title: 本番 DB の称号を消すか\n")
    expect(text).toContain("defaultAction: 消さずに残す\n")
    expect(text.split("\n").filter((line) => /\s$/.test(line))).toEqual([])
    expect(getQuestion(store, "1", NOW)).toEqual(created)
  })

  test("answerBy accepts minutes, hours, days, and an ISO datetime", () => {
    const store = workspace()
    expect(saveQuestion(store, { title: "a", answerBy: "30m" }, NOW).answerBy).toBe(
      "2026-09-25T09:30:00.000Z",
    )
    expect(saveQuestion(store, { title: "b", answerBy: "1d" }, NOW).answerBy).toBe(
      "2026-09-26T09:00:00.000Z",
    )
    expect(
      saveQuestion(store, { title: "c", answerBy: "2026-09-30T18:00:00+09:00" }, NOW).answerBy,
    ).toBe("2026-09-30T09:00:00.000Z")
    expect(() => saveQuestion(store, { title: "d", answerBy: "tomorrow" }, NOW)).toThrow(
      "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual tomorrow",
    )
  })

  test("an open question past answerBy reads as expired", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", answerBy: "1h", defaultAction: "進める" }, NOW)
    const later = new Date("2026-09-25T10:00:00.000Z")
    expect(getQuestion(store, "1", later).status).toBe("expired")
    expect(listQuestions(store, { status: "expired" }, later).map((row) => row.id)).toEqual(["1"])
    expect(listQuestions(store, { status: "open" }, later)).toEqual([])
  })

  test("answer records the answer, who answered, and when, and survives reading back", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", body: "context" }, NOW)
    const answeredAt = new Date("2026-09-25T09:05:00.000Z")
    const answered = answerQuestion(store, "1", { body: "残す\n\n理由は後で" }, answeredAt)
    expect(answered).toMatchObject({
      status: "answered",
      answer: "残す\n\n理由は後で",
      answeredAt: answeredAt.toISOString(),
      body: "context",
    })
    expect(answered.answeredBy).toBeTruthy()
    expect(getQuestion(store, "1", answeredAt)).toEqual(answered)
    const text = readFileSync(join(store.dir, "questions", "1.md"), "utf8")
    expect(text).toContain(QUESTION_ANSWER_MARKER)
  })

  test("an answered question past answerBy stays answered", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", answerBy: "1h" }, NOW)
    answerQuestion(store, "1", { body: "yes" }, NOW)
    expect(getQuestion(store, "1", new Date("2026-09-26T00:00:00.000Z")).status).toBe("answered")
  })

  test("a late answer to an expired question is accepted", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", answerBy: "1h" }, NOW)
    const later = new Date("2026-09-25T12:00:00.000Z")
    expect(answerQuestion(store, "1", { body: "yes" }, later).status).toBe("answered")
  })

  test("cancel withdraws a question and blocks answering it", () => {
    const store = workspace()
    saveQuestion(store, { title: "q" }, NOW)
    const canceled = saveQuestion(store, { id: "1", status: "canceled" }, NOW)
    expect(canceled.status).toBe("canceled")
    expect(canceled.canceledAt).toBe(NOW.toISOString())
    expect(() => answerQuestion(store, "1", { body: "yes" }, NOW)).toThrow(
      "cannot answer question 1: expected status open or expired, actual canceled",
    )
    const reopened = saveQuestion(store, { id: "1", status: "open" }, NOW)
    expect(reopened.status).toBe("open")
    expect(reopened.canceledAt).toBeNull()
  })

  test("update changes only the given fields and none clears optional ones", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(
      store,
      { title: "q", issue: "1", priority: "low", defaultAction: "x", answerBy: "1h" },
      NOW,
    )
    const updated = saveQuestion(
      store,
      { id: "1", priority: "urgent", defaultAction: "none", answerBy: "none" },
      NOW,
    )
    expect(updated).toMatchObject({
      title: "q",
      issue: "1",
      priority: "urgent",
      defaultAction: null,
      answerBy: null,
    })
  })

  test("list filters by status and issue and orders open questions first, newest first", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(store, { title: "first", issue: "1" }, NOW)
    saveQuestion(store, { title: "second" }, new Date("2026-09-25T09:01:00.000Z"))
    saveQuestion(store, { title: "third", issue: "1" }, new Date("2026-09-25T09:02:00.000Z"))
    answerQuestion(store, "3", { body: "done" }, NOW)
    expect(listQuestions(store, {}, NOW).map((row) => row.id)).toEqual(["2", "1", "3"])
    expect(listQuestions(store, { issue: "1" }, NOW).map((row) => row.id)).toEqual(["1", "3"])
    expect(listQuestions(store, { status: "answered" }, NOW).map((row) => row.id)).toEqual(["3"])
    expect(() => listQuestions(store, { status: "pending" }, NOW)).toThrow(
      "invalid status: expected open, expired, answered, or canceled, actual pending",
    )
  })

  test("validation errors show the expected and the actual value", () => {
    const store = workspace()
    expect(() => saveQuestion(store, {}, NOW)).toThrow("title is required when creating a question")
    expect(() => saveQuestion(store, { title: "q", issue: "9" }, NOW)).toThrow("issue not found: 9")
    expect(() => saveQuestion(store, { title: "q", priority: "now" }, NOW)).toThrow(
      "invalid priority: expected urgent, high, medium, or low, actual now",
    )
    expect(() =>
      saveQuestion(store, { title: "q", body: `a\n${QUESTION_ANSWER_MARKER}\nb` }, NOW),
    ).toThrow(`invalid body: must not contain ${QUESTION_ANSWER_MARKER}`)
    expect(() => saveQuestion(store, { id: "9", title: "q" }, NOW)).toThrow("question not found: 9")
    expect(() => saveQuestion(store, { id: "1", status: "answered" }, NOW)).toThrow(
      "invalid status: expected open or canceled, actual answered",
    )
    saveQuestion(store, { title: "q" }, NOW)
    expect(() => answerQuestion(store, "1", { body: " " }, NOW)).toThrow(
      'invalid answer: expected a non-empty string, actual " "',
    )
  })

  test("newlines in single-line fields collapse to spaces", () => {
    const store = workspace()
    const created = saveQuestion(store, { title: "a\nb", defaultAction: "c\nd" }, NOW)
    expect(created.title).toBe("a b")
    expect(created.defaultAction).toBe("c d")
  })

  test("the questions folder ignores itself in git so live questions are never committed", () => {
    const store = workspace()
    Bun.spawnSync(["git", "init", "-q"], { cwd: store.root })
    saveQuestion(store, { title: "q" }, NOW)
    expect(readFileSync(join(store.dir, "questions", ".gitignore"), "utf8")).toBe("*\n")
    const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], {
      cwd: store.root,
      stdout: "pipe",
    })
    expect(status.stdout.toString()).not.toContain("questions")
    expect(listQuestions(store, {}, NOW).map((row) => row.id)).toEqual(["1"])
  })
})
