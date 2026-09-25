import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getPageData } from "./page"
import { answerQuestion, saveQuestion } from "./questions"
import { init, saveIssue } from "./store"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-page-"))
  dirs.push(root)
  return init(root)
}

const NOW = new Date("2026-09-26T12:00:00.000Z")
const DAY = 86_400_000

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY)
}

function page(store: ReturnType<typeof workspace>, search = "") {
  return getPageData(store, new URL(`http://localhost/${search}`), "/p/app", NOW)
}

describe("page data", () => {
  test("issues are ordered by priority then newest id, not by when they were last touched", () => {
    const store = workspace()
    for (let index = 1; index <= 10; index++) {
      saveIssue(store, { title: `issue ${index}` }, { now: daysAgo(1) })
    }
    saveIssue(store, { id: "9", priority: "high" }, { now: daysAgo(1) })
    saveIssue(store, { id: "2", priority: "high" }, { now: daysAgo(1) })
    saveIssue(store, { id: "1", body: "touched just now" }, { now: NOW })
    const data = page(store)
    expect(data.issues.map((issue) => issue.id)).toEqual([
      "9",
      "2",
      "10",
      "8",
      "7",
      "6",
      "5",
      "4",
      "3",
      "1",
    ])
    expect(data.display).toEqual({ sort: "priority", group: "status", completed: "recent" })
    expect(page(store, "?sort=updated").issues[0]!.id).toBe("1")
    expect(page(store, "?sort=updated&group=label&completed=all").display).toEqual({
      sort: "updated",
      group: "label",
      completed: "all",
    })
  })

  test("an unknown display option is an error instead of a silent default", () => {
    const store = workspace()
    expect(() => page(store, "?sort=title")).toThrow(
      'invalid sort: expected priority, updated, created, or due, actual "title"',
    )
  })

  test("finished issues older than a week are hidden unless asked for", () => {
    const store = workspace()
    saveIssue(store, { title: "open" }, { now: daysAgo(30) })
    saveIssue(store, { title: "done long ago", status: "done" }, { now: daysAgo(30) })
    saveIssue(store, { title: "done this week", status: "done" }, { now: daysAgo(2) })
    const titles = (search: string) => page(store, search).issues.map((issue) => issue.title)
    expect(titles("")).toEqual(["done this week", "open"])
    expect(titles("?completed=hide")).toEqual(["open"])
    expect(titles("?completed=all")).toEqual(["done this week", "done long ago", "open"])
    // 完了の列だけを開いたときに古いものが消えると、無いものと思われるので全て出す
    expect(titles("?status=done")).toEqual(["done this week", "done long ago"])
    expect(page(store, "?status=done&completed=recent").display.completed).toBe("all")
    // all は絞り込みに関わらず全ての issue を持つ (親や blocks を選ぶ一覧に使うため)
    expect(page(store, "?completed=hide").all).toHaveLength(3)
  })

  test("in progress issues untouched for a day are marked stale", () => {
    const store = workspace()
    saveIssue(store, { title: "stuck", status: "in_progress" }, { now: daysAgo(2) })
    saveIssue(store, { title: "moving", status: "in_progress" }, { now: NOW })
    expect(page(store).issues.map((issue) => [issue.title, issue.stale])).toEqual([
      ["moving", false],
      ["stuck", true],
    ])
  })

  test("awaiting questions are summarized per issue and can narrow the list", () => {
    const store = workspace()
    saveIssue(store, { title: "asks" })
    saveIssue(store, { title: "quiet" })
    saveIssue(store, { title: "expired only" })
    saveQuestion(store, { title: "later", issue: "1", answerBy: "3h" }, NOW)
    saveQuestion(store, { title: "sooner", issue: "1", answerBy: "1h" }, NOW)
    saveQuestion(store, { title: "no deadline", issue: "1" }, NOW)
    saveQuestion(store, { title: "gone", issue: "3", answerBy: "1h" }, daysAgo(1))
    saveQuestion(store, { title: "answered", issue: "2" }, NOW)
    answerQuestion(store, "5", { body: "yes" }, NOW)
    saveQuestion(store, { title: "unlinked" }, NOW)
    const data = page(store)
    expect(data.awaitingByIssue).toEqual({
      "1": {
        count: 3,
        expired: 0,
        soonestAnswerBy: new Date(NOW.getTime() + 3_600_000).toISOString(),
      },
      "3": { count: 1, expired: 1, soonestAnswerBy: null },
    })
    expect(data.awaitingQuestionCount).toBe(5)
    expect(data.awaiting).toBe(false)
    const awaiting = page(store, "?awaiting=1")
    expect(awaiting.awaiting).toBe(true)
    expect(awaiting.issues.map((issue) => issue.title)).toEqual(["expired only", "asks"])
  })

  test("a link to an issue that does not exist shows the board with an error", () => {
    const store = workspace()
    saveIssue(store, { title: "exists" })
    const data = page(store, "?id=9")
    expect(data.current).toBeNull()
    expect(data.error).toBe("issue not found: 9")
    expect(data.issues).toHaveLength(1)
    expect(data.events).toEqual([])
    expect(data.commits).toEqual([])
  })

  test("a broken issue file is still an error", () => {
    const store = workspace()
    saveIssue(store, { title: "exists" })
    writeFileSync(join(store.dir, "issues", "1.md"), "---\nstatus: nope\n---\n")
    expect(() => page(store, "?id=1")).toThrow("invalid status")
  })

  test("the current issue carries its property history and related commits", () => {
    const store = workspace()
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(
        ["git", "-c", "user.name=tester", "-c", "user.email=t@example.com", ...args],
        { cwd: store.root, stdout: "pipe", stderr: "pipe" },
      )
      if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    }
    git("init", "-q", "-b", "main")
    git("commit", "-q", "--allow-empty", "-m", "板を直す #1")
    git("commit", "-q", "--allow-empty", "-m", "関係ない")
    saveIssue(store, { title: "task" }, { now: daysAgo(1) })
    saveIssue(store, { id: "1", status: "in_progress" }, { now: NOW })
    const data = page(store, "?id=1")
    expect(data.current?.title).toBe("task")
    expect(data.error).toBeUndefined()
    expect(data.events.map(({ field, from, to }) => ({ field, from, to }))).toEqual([
      { field: "status", from: "todo", to: "in_progress" },
    ])
    expect(data.commits.map((commit) => commit.subject)).toEqual(["板を直す #1"])
    expect(page(store).events).toEqual([])
    expect(page(store).commits).toEqual([])
  })

  test("an issue with a hand made name that is not a number opens without commits", () => {
    const store = workspace()
    writeFileSync(join(store.dir, "issues", "notes.md"), "---\ntitle: notes\nstatus: todo\n---\n")
    const data = page(store, "?id=notes")
    expect(data.current?.title).toBe("notes")
    expect(data.commits).toEqual([])
  })

  test("a new issue draft has no history, commits, or error", () => {
    const store = workspace()
    const data = page(store, "?id=new&new_status=in_progress")
    expect(data.current).toMatchObject({ id: "", status: "in_progress", stale: false })
    expect(data.events).toEqual([])
    expect(data.commits).toEqual([])
    expect(data.error).toBeUndefined()
  })
})
