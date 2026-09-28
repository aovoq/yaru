import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  cliCommand,
  compareSnapshots,
  execute,
  formatDifferences,
  normalizeText,
  repositoryRoot,
  runScenario,
  type Snapshot,
} from "./run"

test("temp directories become placeholders and the longer path wins", () => {
  const root = mkdtempSync(join(tmpdir(), "yaru-golden-norm-"))
  const workspaceDirectory = join(root, "workspace")
  const stateDirectory = join(root, "state")
  const worktreeDirectory = join(workspaceDirectory, "nested")
  mkdirSync(worktreeDirectory, { recursive: true })
  mkdirSync(stateDirectory, { recursive: true })
  try {
    const repositoryDirectory = join(root, "repository")
    mkdirSync(repositoryDirectory)
    const text = [
      workspaceDirectory,
      `/private${workspaceDirectory}`,
      stateDirectory,
      worktreeDirectory,
      `${workspaceDirectory}/.yaru/issues/1.md`,
      `${repositoryDirectory}/src/web.tsx`,
    ].join("\n")
    const normalized = normalizeText(text, {
      workspaceDirectory,
      stateDirectory,
      worktrees: [{ name: "nested", directory: worktreeDirectory }],
      repositoryDirectory,
    })
    expect(normalized).toBe(
      [
        "<WORKSPACE>",
        "<WORKSPACE>",
        "<STATE>",
        "<WORKTREE:nested>",
        "<WORKSPACE>/.yaru/issues/1.md",
        "<REPOSITORY>/src/web.tsx",
      ].join("\n"),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("differences name the scenario, the step, and which field changed", () => {
  const expected: Snapshot = {
    name: "issue-create",
    steps: [
      {
        arguments: ["issue", "get", "1"],
        stdout: '{\n  "id": "1"\n}\n',
        stderr: "",
        exitCode: 0,
      },
    ],
    yaru: [{ path: "issues/1.md", content: "title: gate\n" }],
    state: [{ path: "workspaces.json", content: "{}\n" }],
  }
  const actual: Snapshot = {
    name: "issue-create",
    steps: [
      {
        arguments: ["issue", "get", "1"],
        stdout: '{\n  "id": "2"\n}\n',
        stderr: "issue not found: 1\n",
        exitCode: 1,
      },
    ],
    yaru: [{ path: "issues/2.md", content: "title: other\n" }],
    state: [],
  }
  const report = formatDifferences(compareSnapshots(expected, actual))
  expect(report).toContain("scenario issue-create")
  expect(report).toContain("step 1 (issue get 1)")
  expect(report).toContain("stdout")
  expect(report).toContain("stderr")
  expect(report).toContain("exit code")
  expect(report).toContain("expected 0, actual 1")
  expect(report).toContain(".yaru/issues/1.md")
  expect(report).toContain(".yaru/issues/2.md")
  expect(report).toContain("state/workspaces.json")
  expect(compareSnapshots(expected, expected)).toEqual([])
})

test("without YARU_BIN the CLI is bun running this repository", () => {
  const previous = process.env.YARU_BIN
  delete process.env.YARU_BIN
  try {
    expect(cliCommand(repositoryRoot())).toEqual([
      "bun",
      "--jsx-import-source=preact",
      join(repositoryRoot(), "src", "index.ts"),
    ])
  } finally {
    if (previous === undefined) delete process.env.YARU_BIN
    else process.env.YARU_BIN = previous
  }
})

test("YARU_BIN replaces the CLI and the real state directory stays untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "yaru-golden-bin-"))
  const sentinelState = mkdtempSync(join(tmpdir(), "yaru-golden-sentinel-"))
  const fakeBin = join(root, "fake-yaru.sh")
  writeFileSync(
    fakeBin,
    [
      "#!/bin/sh",
      "printf 'marker:fake-yaru\\n'",
      "printf 'args:%s\\n' \"$*\"",
      "printf 'now:%s\\n' \"${YARU_NOW-}\"",
      "printf 'state:%s\\n' \"${YARU_STATE_DIR-}\"",
      "printf 'session:%s\\n' \"${CLAUDE_CODE_SESSION_ID-}\"",
      'mkdir -p "$PWD/.yaru" "$YARU_STATE_DIR"',
      'printf \'cwd:%s\\n\' "$PWD" > "$PWD/.yaru/note.txt"',
      'printf \'state:%s\\n\' "$YARU_STATE_DIR" > "$YARU_STATE_DIR/marker.txt"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  )
  const previous = {
    bin: process.env.YARU_BIN,
    state: process.env.YARU_STATE_DIR,
    now: process.env.YARU_NOW,
    session: process.env.CLAUDE_CODE_SESSION_ID,
  }
  process.env.YARU_BIN = fakeBin
  process.env.YARU_STATE_DIR = sentinelState
  process.env.YARU_NOW = "1999-01-01T00:00:00.000Z"
  process.env.CLAUDE_CODE_SESSION_ID = "session-should-not-leak"
  try {
    const snapshot = await runScenario({
      name: "fake-bin",
      description: "a stand-in CLI",
      steps: [
        { arguments: ["init"], now: "2026-09-28T12:00:00.000Z" },
        {
          arguments: ["issue", "list"],
          environment: { CLAUDE_CODE_SESSION_ID: "scenario-session" },
          now: "2026-09-28T13:00:00.000Z",
        },
      ],
    })
    expect(snapshot.steps[0]?.stdout).toContain("marker:fake-yaru")
    expect(snapshot.steps[0]?.stdout).toContain("args:init")
    expect(snapshot.steps[0]?.stdout).toContain("now:2026-09-28T12:00:00.000Z")
    expect(snapshot.steps[0]?.stdout).toContain("state:<STATE>")
    expect(snapshot.steps[0]?.stdout).not.toContain("session-should-not-leak")
    expect(snapshot.steps[0]?.stdout).not.toContain("1999-01-01")
    expect(snapshot.steps[1]?.stdout).toContain("session:scenario-session")
    expect(snapshot.steps[1]?.stdout).toContain("now:2026-09-28T13:00:00.000Z")
    expect(snapshot.yaru).toEqual([{ path: "note.txt", content: "cwd:<WORKSPACE>\n" }])
    expect(snapshot.state).toEqual([{ path: "marker.txt", content: "state:<STATE>\n" }])
    expect(JSON.stringify(snapshot)).not.toContain("yaru-golden-")
    expect(JSON.stringify(snapshot)).not.toContain(sentinelState)
    expect(readdirSync(sentinelState)).toEqual([])
  } finally {
    restoreEnvironment(previous)
    rmSync(root, { recursive: true, force: true })
    rmSync(sentinelState, { recursive: true, force: true })
  }
})

test("check exits 1 and names the scenario, step, and stream", async () => {
  const root = mkdtempSync(join(tmpdir(), "yaru-golden-check-"))
  const scenariosDirectory = join(root, "scenarios")
  const snapshotsDirectory = join(root, "snapshots")
  mkdirSync(scenariosDirectory)
  mkdirSync(snapshotsDirectory)
  const fakeBin = join(root, "fake-yaru.sh")
  writeFileSync(fakeBin, "#!/bin/sh\nprintf 'actual\\n'\n", { mode: 0o755 })
  writeFileSync(
    join(scenariosDirectory, "issue-create.json"),
    `${JSON.stringify(
      {
        name: "issue-create",
        description: "create an issue",
        steps: [{ arguments: ["init"], now: "2026-09-28T12:00:00.000Z" }],
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(snapshotsDirectory, "issue-create.json"),
    `${JSON.stringify(
      {
        name: "issue-create",
        steps: [{ arguments: ["init"], stdout: "expected\n", stderr: "", exitCode: 0 }],
        yaru: [],
        state: [],
      },
      null,
      2,
    )}\n`,
  )
  const previousBin = process.env.YARU_BIN
  process.env.YARU_BIN = fakeBin
  try {
    const result = await execute([
      "--check",
      "--scenarios",
      scenariosDirectory,
      "--snapshots",
      snapshotsDirectory,
    ])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("scenario issue-create")
    expect(result.stderr).toContain("step 1 (init)")
    expect(result.stderr).toContain("stdout")
    expect(result.stderr).toContain("-expected")
    expect(result.stderr).toContain("+actual")
  } finally {
    if (previousBin === undefined) delete process.env.YARU_BIN
    else process.env.YARU_BIN = previousBin
    rmSync(root, { recursive: true, force: true })
  }
})

test("recorded scenarios match the TypeScript CLI", async () => {
  const previous = process.env.YARU_BIN
  delete process.env.YARU_BIN
  try {
    const result = await execute(["--check"])
    expect(result.stderr).toBe("")
    expect(result.exitCode).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.YARU_BIN
    else process.env.YARU_BIN = previous
  }
})

function restoreEnvironment(previous: {
  bin: string | undefined
  state: string | undefined
  now: string | undefined
  session: string | undefined
}): void {
  if (previous.bin === undefined) delete process.env.YARU_BIN
  else process.env.YARU_BIN = previous.bin
  if (previous.state === undefined) delete process.env.YARU_STATE_DIR
  else process.env.YARU_STATE_DIR = previous.state
  if (previous.now === undefined) delete process.env.YARU_NOW
  else process.env.YARU_NOW = previous.now
  if (previous.session === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = previous.session
}
