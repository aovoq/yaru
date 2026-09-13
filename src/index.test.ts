import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildDistribution } from "./build"

// bin として配る dist/yaru.js と同じビルドを実行し、
// 作業ディレクトリに tsconfig.json が無くても動くことをあわせて確かめる
const distributionDirectory = mkdtempSync(join(tmpdir(), "yaru-cli-bin-"))
const cli = join(distributionDirectory, "yaru.js")
const dirs: string[] = []

beforeAll(async () => {
  await buildDistribution(cli)
})

afterAll(() => {
  rmSync(distributionDirectory, { recursive: true, force: true })
})

function run(args: string[], cwd?: string, stdin?: string) {
  return Bun.spawnSync([cli, ...args], {
    cwd,
    stdin: stdin !== undefined ? Buffer.from(stdin) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  })
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-cli-"))
  dirs.push(root)
  const init = run(["init"], root)
  if (init.exitCode !== 0) throw new Error(init.stderr.toString())
  return root
}

function ymd(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test("help exits 0", () => {
  expect(run(["--help"]).exitCode).toBe(0)
  expect(run(["-h"]).exitCode).toBe(0)
})

test("help shows yaru commands", () => {
  const help = run(["--help"]).stdout.toString()
  expect(help).toContain("yaru issue save")
  expect(help).toContain("yaru serve")
})

test("bun run yaru forwards issue args", () => {
  const root = join(import.meta.dir, "..")
  const out = Bun.spawnSync(["bun", "run", "yaru", "issue", "list"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(out.exitCode).toBe(0)
})

test("no args exits 1", () => {
  expect(run([]).exitCode).toBe(1)
})

test("bare value flags error instead of storing true", () => {
  const out = run(["issue", "save", "--title", "x", "--body"])
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain("missing value for --body")
})

test("list help mentions filters format and overdue", () => {
  const help = run(["issue", "list", "--help"]).stdout.toString()
  expect(help).toContain("--due overdue")
  expect(help).toContain("--format")
  expect(help).toContain("--parent")
  expect(help).toContain("--limit")
  expect(help).toContain("--cursor")
  expect(help).toContain("--assignee me")
})

test("save help documents patch format and linear id rules", () => {
  const help = run(["issue", "save", "--help"]).stdout.toString()
  expect(help).toContain("--dueDate")
  expect(help).toContain("--priority")
  expect(help).toContain("--patch")
  expect(help).toContain("--format")
  expect(help).toContain("--parent")
  expect(help).toContain("--block")
  expect(help).toContain("Do not pass --id when creating")
  expect(help).toContain("replace_range")
  expect(help).toContain("none")
  expect(help).toContain("exactly once")
})

test("subcommand help does not require a workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "yaru-cli-help-"))
  dirs.push(root)
  const out = run(["issue", "get", "--help"], root)
  expect(out.exitCode).toBe(0)
  expect(out.stderr.toString()).toBe("")
  expect(out.stdout.toString()).toContain("yaru issue get")
})

test("save get list dueDate and overdue", () => {
  const root = workspace()
  const yesterday = ymd(-1)
  expect(run(["issue", "save", "--title", "late", "--dueDate", yesterday], root).exitCode).toBe(0)
  expect(run(["issue", "save", "--title", "soon", "--dueDate", ymd(1)], root).exitCode).toBe(0)
  const got = run(["issue", "get", "1"], root).stdout.toString()
  expect(got).toContain(yesterday)
  expect(got).toContain("late")
  const overdue = run(["issue", "list", "--due", "overdue"], root).stdout.toString()
  expect(overdue).toContain("late")
  expect(overdue).not.toContain("soon")
})

test("save rejects invalid dueDate", () => {
  const root = workspace()
  const out = run(["issue", "save", "--title", "x", "--dueDate", "2026-02-30"], root)
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain("invalid dueDate")
})

test("save get list priority", () => {
  const root = workspace()
  expect(run(["issue", "save", "--title", "hot", "--priority", "urgent"], root).exitCode).toBe(0)
  const got = run(["issue", "get", "1"], root).stdout.toString()
  expect(got).toContain("urgent")
  const list = run(["issue", "list"], root).stdout.toString()
  expect(list).toContain("urgent")
  expect(run(["issue", "save", "--id", "1", "--priority", "none"], root).exitCode).toBe(0)
  expect(run(["issue", "get", "1"], root).stdout.toString()).not.toContain("urgent")
})

test("save rejects unknown priority", () => {
  const root = workspace()
  const out = run(["issue", "save", "--title", "x", "--priority", "p0"], root)
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain(
    "invalid priority: expected urgent, high, medium, or low, actual p0",
  )
})

test("save rejects unknown status with expected values", () => {
  const root = workspace()
  const out = run(["issue", "save", "--title", "x", "--status", "nope"], root)
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain(
    "invalid status: expected backlog, todo, in_progress, done, or canceled, actual nope",
  )
})

test("save with unused id does not create", () => {
  const root = workspace()
  const out = run(["issue", "save", "--id", "9", "--title", "x"], root)
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain("issue not found: 9")
  expect(run(["issue", "get", "9"], root).exitCode).toBe(1)
})

test("save rejects a positional argument", () => {
  const root = workspace()
  const out = run(["issue", "save", "1", "--title", "x"], root)
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain("unexpected argument: 1")
})

test("list rejects unknown flags", () => {
  const root = workspace()
  const out = run(["issue", "list", "--foo", "bar"], root)
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain("unknown flag: --foo")
})

test("json list get and save return issue objects", () => {
  const root = workspace()
  const saveOut = run(["issue", "save", "--title", "hello", "--label", "cli"], root)
  const saved = JSON.parse(saveOut.stdout.toString())
  expect(saved).toMatchObject({
    id: "1",
    title: "hello",
    status: "todo",
    labels: ["cli"],
    assignee: null,
    dueDate: null,
    priority: null,
    body: "",
  })
  expect(saved.createdAt).toBeTruthy()
  expect(saved.updatedAt).toBeTruthy()
  expect(saveOut.stdout.toString()).not.toContain("http://")

  const listed = JSON.parse(run(["issue", "list"], root).stdout.toString())
  expect(listed.hasNextPage).toBe(false)
  expect(listed.issues).toHaveLength(1)
  expect(listed.issues[0].labels).toEqual(["cli"])
  expect(listed.issues[0].createdAt).toBe(saved.createdAt)

  const got = JSON.parse(run(["issue", "get", "1"], root).stdout.toString())
  expect(got).toMatchObject({ id: "1", title: "hello", labels: ["cli"], body: "" })
})

test("json list is empty without printing (none)", () => {
  const root = workspace()
  const out = run(["issue", "list"], root)
  expect(out.exitCode).toBe(0)
  expect(out.stdout.toString()).not.toContain("(none)")
  expect(JSON.parse(out.stdout.toString())).toEqual({ issues: [], hasNextPage: false })
})

test("format flag without a value prints a table", () => {
  const root = workspace()
  expect(run(["issue", "save", "--title", "hello"], root).exitCode).toBe(0)
  const out = run(["issue", "list", "--format"], root)
  expect(out.exitCode).toBe(0)
  expect(out.stdout.toString()).toContain("hello")
  expect(out.stdout.toString()).not.toContain("{")
  const short = run(["issue", "list", "-f"], root)
  expect(short.stdout.toString()).toContain("hello")
})

test("list paginates with limit and cursor", () => {
  const root = workspace()
  expect(run(["issue", "save", "--title", "a"], root).exitCode).toBe(0)
  expect(run(["issue", "save", "--title", "b"], root).exitCode).toBe(0)
  expect(run(["issue", "save", "--title", "c"], root).exitCode).toBe(0)
  const first = JSON.parse(run(["issue", "list", "--limit", "2"], root).stdout.toString())
  expect(first.issues.map((issue: { id: string }) => issue.id)).toEqual(["3", "2"])
  expect(first.hasNextPage).toBe(true)
  expect(first.cursor).toBe("2")
  const second = JSON.parse(
    run(["issue", "list", "--limit", "2", "--cursor", first.cursor], root).stdout.toString(),
  )
  expect(second.issues.map((issue: { id: string }) => issue.id)).toEqual(["1"])
  expect(second.hasNextPage).toBe(false)
})

test("list rejects an invalid limit", () => {
  const root = workspace()
  const out = run(["issue", "list", "--limit", "0"], root)
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain(
    "invalid limit: expected an integer from 1 to 250, actual 0",
  )
})

test("save patch updates body without replacing it", () => {
  const root = workspace()
  expect(run(["issue", "save", "--title", "x", "--body", "alpha beta"], root).exitCode).toBe(0)
  const patch = JSON.stringify([{ op: "replace", old_string: "beta", new_string: "BETA" }])
  expect(run(["issue", "save", "--id", "1", "--patch", patch], root).exitCode).toBe(0)
  expect(run(["issue", "get", "1"], root).stdout.toString()).toContain("alpha BETA")
})

test("save patch reads stdin", () => {
  const root = workspace()
  expect(run(["issue", "save", "--title", "x", "--body", "core"], root).exitCode).toBe(0)
  const out = run(
    ["issue", "save", "--id", "1", "--patch", "-"],
    root,
    JSON.stringify([{ op: "append", text: "!" }]),
  )
  expect(out.exitCode).toBe(0)
  expect(run(["issue", "get", "1"], root).stdout.toString()).toContain("core!")
})

test("save parent blocks and timestamps appear in json", () => {
  const root = workspace()
  expect(run(["issue", "save", "--title", "parent"], root).exitCode).toBe(0)
  expect(run(["issue", "save", "--title", "child", "--parent", "1"], root).exitCode).toBe(0)
  const child = JSON.parse(run(["issue", "get", "2"], root).stdout.toString())
  expect(child.parent).toBe("1")
  const parent = JSON.parse(
    run(["issue", "save", "--id", "1", "--block", "2"], root).stdout.toString(),
  )
  expect(parent.blocks).toEqual(["2"])
  expect(parent.children).toEqual(["2"])
  const blocked = JSON.parse(run(["issue", "get", "2"], root).stdout.toString())
  expect(blocked.blockedBy).toEqual(["1"])
  const started = JSON.parse(
    run(["issue", "save", "--id", "2", "--status", "in_progress"], root).stdout.toString(),
  )
  expect(started.startedAt).toBeTruthy()
  expect(started.completedAt).toBeNull()
})

test("comment save list get roundtrip", () => {
  const root = workspace()
  expect(run(["issue", "save", "--title", "topic"], root).exitCode).toBe(0)
  const created = JSON.parse(
    run(["comment", "save", "--issue", "1", "--body", "hello"], root).stdout.toString(),
  )
  expect(created).toMatchObject({ id: "1", issue: "1", parent: null, body: "hello" })
  const reply = JSON.parse(
    run(["comment", "save", "--parent", "1", "--body", "reply"], root).stdout.toString(),
  )
  expect(reply.parent).toBe("1")
  const listed = JSON.parse(run(["comment", "list", "--issue", "1"], root).stdout.toString())
  expect(listed.comments.map((comment: { id: string }) => comment.id)).toEqual(["1", "2"])
  const got = JSON.parse(run(["comment", "get", "1"], root).stdout.toString())
  expect(got.body).toBe("hello")
})

test("save rejects body and patch together", () => {
  const root = workspace()
  expect(run(["issue", "save", "--title", "x", "--body", "keep"], root).exitCode).toBe(0)
  const out = run(
    [
      "issue",
      "save",
      "--id",
      "1",
      "--body",
      "new",
      "--patch",
      JSON.stringify([{ op: "append", text: "!" }]),
    ],
    root,
  )
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain("cannot pass body and patch together")
})
