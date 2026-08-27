import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const cli = join(import.meta.dir, "index.ts")
const dirs: string[] = []

function run(args: string[], cwd?: string) {
  return Bun.spawnSync(["bun", cli, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-cli-"))
  dirs.push(root)
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "hono/jsx" } }),
  )
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

test("help shows bun yaru commands", () => {
  const help = run(["--help"]).stdout.toString()
  expect(help).toContain("bun yaru issue save")
  expect(help).toContain("bun yaru serve")
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

test("help mentions dueDate and overdue", () => {
  const help = run(["--help"]).stdout.toString()
  expect(help).toContain("--due overdue")
  expect(help).toContain("--dueDate")
  expect(help).toContain("--priority")
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
  expect(out.stderr.toString()).toContain("invalid priority")
})
