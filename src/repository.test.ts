import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitsForIssue, readRepositoryState } from "./repository"

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

// 並べる順を確かめるため、コミットの日時を 1 分ずつずらして決める
function commitAt(cwd: string, file: string, subject: string, minute: number) {
  const date = `2026-09-20T00:${String(minute).padStart(2, "0")}:00Z`
  writeFileSync(join(cwd, file), subject)
  git(cwd, "add", file)
  const result = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=tester",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--date",
      date,
      "-m",
      subject,
    ],
    { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_COMMITTER_DATE: date } },
  )
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function repositoryWithIssueCommits() {
  const root = directory("yaru-issue-commits-")
  git(root, "init", "-q", "-b", "main")
  commitAt(root, "a.txt", "土台を作る", 0)
  commitAt(root, "b.txt", "一覧を直す #1", 1)
  commitAt(root, "c.txt", "別の件 #12", 2)
  commitAt(root, "d.txt", "関係ない", 3)
  git(root, "switch", "-q", "-c", "feature/x")
  commitAt(root, "e.txt", "途中まで", 4)
  commitAt(root, "f.txt", "続き (#1)", 5)
  git(root, "switch", "-q", "main")
  return root
}

test("commits for an issue are the ones mentioning #id and the ones on its branch", () => {
  const root = repositoryWithIssueCommits()
  const commits = commitsForIssue(root, "1", "feature/x")
  expect(commits.map((row) => row.subject)).toEqual(["続き (#1)", "途中まで", "一覧を直す #1"])
  expect(commits[0]).toMatchObject({ author: "tester", committedAt: "2026-09-20T00:05:00Z" })
  expect(commits[0]!.hash).toMatch(/^[0-9a-f]{7,}$/)
})

test("commits for an issue say whether the folder's upstream already has them", () => {
  const remote = directory("yaru-remote-")
  git(remote, "init", "-q", "--bare", "-b", "main")
  const root = directory("yaru-issue-commits-")
  git(root, "init", "-q", "-b", "main")
  git(root, "remote", "add", "origin", remote)
  commitAt(root, "a.txt", "一覧を直す #1", 0)
  git(root, "push", "-q", "-u", "origin", "main")
  commitAt(root, "b.txt", "まだ送っていない #1", 1)
  git(root, "switch", "-q", "-c", "feature/x")
  commitAt(root, "c.txt", "ブランチの途中", 2)
  git(root, "switch", "-q", "main")
  expect(
    commitsForIssue(root, "1", "feature/x").map(({ subject, pushed }) => ({ subject, pushed })),
  ).toEqual([
    { subject: "ブランチの途中", pushed: false },
    { subject: "まだ送っていない #1", pushed: false },
    { subject: "一覧を直す #1", pushed: true },
  ])
})

test("commits for an issue have an unknown push state without an upstream", () => {
  const root = repositoryWithIssueCommits()
  expect(commitsForIssue(root, "1", "feature/x").map((row) => row.pushed)).toEqual([
    null,
    null,
    null,
  ])
})

test("#1 does not match a commit that mentions #12", () => {
  const root = repositoryWithIssueCommits()
  expect(commitsForIssue(root, "1", null).map((row) => row.subject)).toEqual([
    "続き (#1)",
    "一覧を直す #1",
  ])
  expect(commitsForIssue(root, "12", null).map((row) => row.subject)).toEqual(["別の件 #12"])
})

test("a branch that no longer exists or looks like an option adds no commits", () => {
  const root = repositoryWithIssueCommits()
  expect(commitsForIssue(root, "12", "deleted/branch").map((row) => row.subject)).toEqual([
    "別の件 #12",
  ])
  expect(commitsForIssue(root, "12", "--all").map((row) => row.subject)).toEqual(["別の件 #12"])
  expect(commitsForIssue(root, "12", "main..feature/x").map((row) => row.subject)).toEqual([
    "別の件 #12",
  ])
})

test("the branch checked out in the folder itself adds no commits beyond the #id ones", () => {
  const root = repositoryWithIssueCommits()
  expect(commitsForIssue(root, "12", "main").map((row) => row.subject)).toEqual(["別の件 #12"])
})

test("commits for an issue are capped", () => {
  const root = directory("yaru-issue-commits-")
  git(root, "init", "-q", "-b", "main")
  for (let index = 0; index < 25; index++) {
    commitAt(root, `${index}.txt`, `step ${index} #3`, index)
  }
  const commits = commitsForIssue(root, "3", null)
  expect(commits).toHaveLength(20)
  expect(commits[0]!.subject).toBe("step 24 #3")
})

test("outside a git repository an issue has no commits", () => {
  expect(commitsForIssue(directory("yaru-plain-"), "1", "main")).toEqual([])
})

test("an issue id that is not a number is rejected", () => {
  expect(() => commitsForIssue(directory("yaru-plain-"), "1|2", null)).toThrow(
    'invalid issue id: expected digits, actual "1|2"',
  )
})
