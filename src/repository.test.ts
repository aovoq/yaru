import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readRepositoryState } from "./repository"

const dirs: string[] = []

function directory(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(path)
  return path
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function commit(cwd: string, file: string, subject: string) {
  writeFileSync(join(cwd, file), subject)
  git(cwd, "add", file)
  git(
    cwd,
    "-c",
    "user.name=tester",
    "-c",
    "user.email=t@example.com",
    "commit",
    "-q",
    "-m",
    subject,
  )
}

test("outside a git repository there is no repository state", () => {
  expect(readRepositoryState(directory("yaru-plain-"))).toBeNull()
})

test("reports the branch, recent commits, uncommitted files, and commits not pushed", () => {
  const remote = directory("yaru-remote-")
  git(remote, "init", "-q", "--bare", "-b", "main")
  const root = directory("yaru-repo-")
  git(root, "init", "-q", "-b", "main")
  git(root, "remote", "add", "origin", remote)
  commit(root, "a.txt", "最初のコミット")
  git(root, "push", "-q", "-u", "origin", "main")
  commit(root, "b.txt", "二つ目")
  commit(root, "c.txt", "三つ目")
  writeFileSync(join(root, "dirty.txt"), "x")
  const state = readRepositoryState(root)!
  expect(state.branch).toBe("main")
  expect(state.upstream).toBe("origin/main")
  expect(state.ahead).toBe(2)
  expect(state.behind).toBe(0)
  expect(state.uncommittedFiles).toBe(1)
  expect(state.commits.map((row) => row.subject)).toEqual(["三つ目", "二つ目", "最初のコミット"])
  expect(state.commits[0]).toMatchObject({ author: "tester", pushed: false })
  expect(state.commits[2]!.pushed).toBe(true)
  expect(state.commits[0]!.hash).toMatch(/^[0-9a-f]{7,}$/)
})

test("a branch without an upstream reports unknown push state", () => {
  const root = directory("yaru-repo-")
  git(root, "init", "-q", "-b", "main")
  commit(root, "a.txt", "only")
  const state = readRepositoryState(root)!
  expect(state.upstream).toBeNull()
  expect(state.ahead).toBeNull()
  expect(state.commits[0]!.pushed).toBeNull()
})
