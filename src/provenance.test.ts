import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readProvenance } from "./provenance"

const dirs: string[] = []

// macOS の一時フォルダは /var が /private/var への symlink なので、git が返す実パスと比べられるよう解決しておく
function directory(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "yaru-provenance-")))
  dirs.push(path)
  return path
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function repository(): string {
  const root = directory()
  git(root, ["init", "--quiet", "--initial-branch", "main"])
  writeFileSync(join(root, "file.txt"), "x\n")
  git(root, ["add", "file.txt"])
  git(root, [
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "init",
  ])
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("readProvenance", () => {
  test("reads the worktree top level and the branch from a subfolder", () => {
    const root = repository()
    git(root, ["switch", "--quiet", "-c", "feat/add-thing"])
    const nested = join(root, "src", "deep")
    mkdirSync(nested, { recursive: true })
    expect(readProvenance(nested, {})).toEqual({
      session: null,
      worktree: root,
      branch: "feat/add-thing",
    })
  })

  test("a linked worktree reports its own folder and branch, not the main worktree", () => {
    const root = repository()
    const linked = join(directory(), "linked")
    git(root, ["worktree", "add", "--quiet", "-b", "feat/fix-other", linked])
    expect(readProvenance(linked, {})).toMatchObject({
      worktree: linked,
      branch: "feat/fix-other",
    })
  })

  test("a detached HEAD has no branch", () => {
    const root = repository()
    git(root, ["switch", "--quiet", "--detach"])
    expect(readProvenance(root, {})).toMatchObject({ worktree: root, branch: null })
  })

  test("outside git both worktree and branch are null", () => {
    expect(readProvenance(directory(), {})).toEqual({
      session: null,
      worktree: null,
      branch: null,
    })
  })

  test("the session comes from Claude Code first, then Codex, ignoring blanks", () => {
    const cwd = directory()
    expect(
      readProvenance(cwd, { CLAUDE_CODE_SESSION_ID: "claude-1", CODEX_SESSION_ID: "codex-1" })
        .session,
    ).toBe("claude-1")
    expect(
      readProvenance(cwd, { CLAUDE_CODE_SESSION_ID: "  ", CODEX_SESSION_ID: "codex-1" }).session,
    ).toBe("codex-1")
    expect(readProvenance(cwd, {}).session).toBeNull()
  })
})
