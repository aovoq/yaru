import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildDistribution } from "./build"

// bin として配る dist/yaru.js と同じビルドを実行し、
// 作業ディレクトリに tsconfig.json が無くても動くことをあわせて確かめる
const distributionDirectory = mkdtempSync(join(tmpdir(), "yaru-cli-bin-"))
const cli = join(distributionDirectory, "yaru.js")
const dirs: string[] = []
// CLI はワークスペースを開くたびに登録するので、テストの登録が本物の一覧に混ざらないよう置き場所を分ける
const stateDirectory = mkdtempSync(join(tmpdir(), "yaru-cli-state-"))
const environment = { ...process.env, YARU_STATE_DIR: stateDirectory }

beforeAll(async () => {
  await buildDistribution(cli)
})

afterAll(() => {
  rmSync(distributionDirectory, { recursive: true, force: true })
  rmSync(stateDirectory, { recursive: true, force: true })
})

function run(
  args: string[],
  cwd?: string,
  stdin?: string,
  extraEnvironment: Record<string, string | undefined> = {},
) {
  return Bun.spawnSync([cli, ...args], {
    cwd,
    env: { ...environment, ...extraEnvironment },
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
    env: environment,
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

test("question save list get answer roundtrip", () => {
  const root = workspace()
  run(["issue", "save", "--title", "topic"], root)
  const created = JSON.parse(
    run(
      [
        "question",
        "save",
        "--title",
        "消すか",
        "--issue",
        "1",
        "--priority",
        "high",
        "--default",
        "残す",
        "--answerBy",
        "2h",
        "--body",
        "背景",
      ],
      root,
    ).stdout.toString(),
  )
  expect(created).toMatchObject({
    id: "1",
    title: "消すか",
    status: "open",
    issue: "1",
    priority: "high",
    defaultAction: "残す",
    body: "背景",
  })
  const listed = JSON.parse(run(["question", "list", "--status", "open"], root).stdout.toString())
  expect(listed.questions.map((question: { id: string }) => question.id)).toEqual(["1"])
  const answered = JSON.parse(
    run(["question", "answer", "1", "--body", "-"], root, "消して\nよい").stdout.toString(),
  )
  expect(answered).toMatchObject({ status: "answered", answer: "消して\nよい" })
  expect(JSON.parse(run(["question", "get", "1"], root).stdout.toString()).status).toBe("answered")
  const human = run(["question", "list", "-f"], root).stdout.toString()
  expect(human).toContain("answered")
  expect(human).toContain("消すか")
})

test("question save records the session, worktree, and branch it was asked from", () => {
  const root = workspace()
  Bun.spawnSync(["git", "init", "--quiet", "--initial-branch", "feat/add-thing"], { cwd: root })
  const created = JSON.parse(
    run(
      ["question", "save", "--title", "q", "--default", "x", "--answerBy", "1h"],
      root,
      undefined,
      {
        CLAUDE_CODE_SESSION_ID: "session-1",
        CODEX_SESSION_ID: undefined,
      },
    ).stdout.toString(),
  )
  expect(created).toMatchObject({
    session: "session-1",
    worktree: realpathSync(root),
    branch: "feat/add-thing",
  })
})

test("question save --option is repeatable and --option none clears the list", () => {
  const root = workspace()
  const created = JSON.parse(
    run(
      [
        "question",
        "save",
        "--title",
        "q",
        "--default",
        "残す",
        "--answerBy",
        "1h",
        "--option",
        "残す",
        "--option",
        "消す, 本番だけ",
      ],
      root,
    ).stdout.toString(),
  )
  expect(created.options).toEqual(["残す", "消す, 本番だけ"])
  const cleared = JSON.parse(
    run(["question", "save", "--id", "1", "--option", "none"], root).stdout.toString(),
  )
  expect(cleared.options).toEqual([])
})

test("question save refuses to ask the same open question twice unless --force", () => {
  const root = workspace()
  run(["question", "save", "--title", "消すか", "--default", "x", "--answerBy", "1h"], root)
  const again = run(
    ["question", "save", "--title", "消すか", "--default", "x", "--answerBy", "1h"],
    root,
  )
  expect(again.exitCode).toBe(1)
  expect(again.stderr.toString()).toContain(
    'duplicate question: expected no open question titled "消すか" without an issue, actual question 1 is open',
  )
  const forced = run(
    ["question", "save", "--title", "消すか", "--default", "x", "--answerBy", "1h", "--force"],
    root,
  )
  expect(forced.exitCode).toBe(0)
  expect(JSON.parse(forced.stdout.toString()).id).toBe("2")
})

test("question save warns when the question has neither a default nor a deadline", () => {
  const root = workspace()
  const blocking = run(["question", "save", "--title", "q"], root)
  expect(blocking.exitCode).toBe(0)
  expect(blocking.stderr.toString()).toContain(
    "warning: question 1 has no --default and no --answerBy",
  )
  const timed = run(
    ["question", "save", "--title", "r", "--default", "x", "--answerBy", "1h"],
    root,
  )
  expect(timed.stderr.toString()).toBe("")
})

test("question answer replaces an existing answer only with --force", () => {
  const root = workspace()
  run(["question", "save", "--title", "q"], root)
  run(["question", "answer", "1", "--body", "first"], root)
  const again = run(["question", "answer", "1", "--body", "second"], root)
  expect(again.exitCode).toBe(1)
  expect(again.stderr.toString()).toContain(
    "cannot answer question 1: expected status open or expired, actual answered",
  )
  const forced = run(["question", "answer", "1", "--body", "second", "--force"], root)
  expect(JSON.parse(forced.stdout.toString()).answer).toBe("second")
})

test("question get and wait record when the agent first picked up the answer", () => {
  const root = workspace()
  run(["question", "save", "--title", "q"], root)
  expect(
    JSON.parse(run(["question", "get", "1"], root).stdout.toString()).acknowledgedAt,
  ).toBeNull()
  run(["question", "answer", "1", "--body", "yes"], root)
  const picked = JSON.parse(run(["question", "wait", "1"], root).stdout.toString())
  expect(picked.acknowledgedAt).toEqual(expect.any(String))
  const again = JSON.parse(run(["question", "get", "1"], root).stdout.toString())
  expect(again.acknowledgedAt).toBe(picked.acknowledgedAt)
})

test("issue save records the session, worktree, and branch it was saved from", () => {
  const root = workspace()
  Bun.spawnSync(["git", "init", "--quiet", "--initial-branch", "feat/fix-thing"], { cwd: root })
  const created = JSON.parse(
    run(["issue", "save", "--title", "topic"], root, undefined, {
      CLAUDE_CODE_SESSION_ID: "session-2",
      CODEX_SESSION_ID: undefined,
    }).stdout.toString(),
  )
  expect(created).toMatchObject({
    session: "session-2",
    worktree: realpathSync(root),
    branch: "feat/fix-thing",
  })
})

test("question save --status canceled withdraws a question", () => {
  const root = workspace()
  run(["question", "save", "--title", "q"], root)
  const canceled = JSON.parse(
    run(["question", "save", "--id", "1", "--status", "canceled"], root).stdout.toString(),
  )
  expect(canceled.status).toBe("canceled")
  const out = run(["question", "answer", "1", "--body", "x"], root)
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain("expected status open or expired, actual canceled")
})

test("question wait returns the answer once it arrives", async () => {
  const root = workspace()
  run(["question", "save", "--title", "q"], root)
  const waiting = Bun.spawn([cli, "question", "wait", "1", "--interval", "50ms"], {
    cwd: root,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  })
  await Bun.sleep(300)
  run(["question", "answer", "1", "--body", "yes"], root)
  expect(await waiting.exited).toBe(0)
  const result = JSON.parse(await new Response(waiting.stdout).text())
  expect(result).toMatchObject({ status: "answered", answer: "yes" })
})

test("question wait returns the default action when answerBy passes", () => {
  const root = workspace()
  run(
    [
      "question",
      "save",
      "--title",
      "q",
      "--default",
      "進める",
      "--answerBy",
      "2026-01-01T00:00:00Z",
    ],
    root,
  )
  const out = run(["question", "wait", "1", "-f"], root)
  expect(out.exitCode).toBe(0)
  expect(out.stdout.toString()).toBe("expired: proceed with the default action\n進める\n")
})

test("question wait exits 2 when the timeout passes first", () => {
  const root = workspace()
  run(["question", "save", "--title", "q"], root)
  const out = run(["question", "wait", "1", "--timeout", "100ms", "--interval", "20ms"], root)
  expect(out.exitCode).toBe(2)
  expect(JSON.parse(out.stdout.toString()).status).toBe("open")
  expect(out.stderr.toString()).toContain("timed out after 100ms waiting for question 1")
})

test("question help documents wait and the default action", () => {
  expect(run(["--help"]).stdout.toString()).toContain("yaru question save")
  const help = run(["question", "wait", "--help"]).stdout.toString()
  expect(help).toContain("--timeout")
  expect(help).toContain("defaultAction")
})

test("asking a question runs the notify command from config.yml with the question on stdin", () => {
  const root = workspace()
  const received = join(root, "received.json")
  writeFileSync(join(root, ".yaru", "config.yml"), `notify: cat > ${JSON.stringify(received)}\n`)
  const out = run(["question", "save", "--title", "消すか", "--default", "残す"], root)
  expect(out.exitCode).toBe(0)
  const payload = JSON.parse(readFileSync(received, "utf8"))
  expect(payload).toMatchObject({
    event: "question.created",
    question: { id: "1", title: "消すか" },
  })
  expect(payload.url).toMatch(/^http:\/\/127\.0\.0\.1:47800\/p\/yaru-cli-[^/]+\/dashboard#q-1$/)
})

test("the notify link uses publicUrl from config.yml so it opens on a phone", () => {
  const root = workspace()
  const received = join(root, "received.json")
  writeFileSync(
    join(root, ".yaru", "config.yml"),
    `publicUrl: https://mac.example.ts.net\nnotify: cat > ${JSON.stringify(received)}\n`,
  )
  run(["question", "save", "--title", "消すか", "--default", "残す", "--answerBy", "1h"], root)
  expect(JSON.parse(readFileSync(received, "utf8")).url).toMatch(
    /^https:\/\/mac\.example\.ts\.net\/p\/yaru-cli-[^/]+\/dashboard#q-1$/,
  )
})

test("a failing notify command warns but keeps the saved question", () => {
  const root = workspace()
  writeFileSync(join(root, ".yaru", "config.yml"), "notify: echo boom >&2; exit 3\n")
  const out = run(["question", "save", "--title", "q"], root)
  expect(out.exitCode).toBe(0)
  expect(JSON.parse(out.stdout.toString()).id).toBe("1")
  expect(out.stderr.toString()).toContain(
    "notify command failed: expected exit code 0, actual 3: boom",
  )
})

test("updating a question does not notify", () => {
  const root = workspace()
  run(["question", "save", "--title", "q"], root)
  const received = join(root, "received.json")
  writeFileSync(join(root, ".yaru", "config.yml"), `notify: cat > ${JSON.stringify(received)}\n`)
  run(["question", "save", "--id", "1", "--priority", "high"], root)
  expect(existsSync(received)).toBe(false)
})

test("using yaru in a workspace registers it for yaru serve", () => {
  const root = workspace()
  run(["issue", "list"], root)
  const registry = JSON.parse(readFileSync(join(stateDirectory, "workspaces.json"), "utf8"))
  expect(registry.workspaces.map((entry: { root: string }) => entry.root)).toContain(
    realpathSync(root),
  )
})

test("issue save stamps createdAt and updatedAt from YARU_NOW", () => {
  const root = workspace()
  const fixed = "2026-09-28T12:00:00.000Z"
  const out = run(["issue", "save", "--title", "frozen clock"], root, undefined, {
    YARU_NOW: fixed,
  })
  expect(out.exitCode).toBe(0)
  const saved = JSON.parse(out.stdout.toString())
  expect(saved.createdAt).toBe(fixed)
  expect(saved.updatedAt).toBe(fixed)
  const file = readFileSync(join(root, ".yaru", "issues", "1.md"), "utf8")
  expect(file).toContain(`createdAt: ${fixed}`)
  expect(file).toContain(`updatedAt: ${fixed}`)
})

test("question wait times out quickly when YARU_NOW is set", async () => {
  const root = workspace()
  run(["question", "save", "--title", "q"], root)
  const started = performance.now()
  const waiting = Bun.spawn(
    [cli, "question", "wait", "1", "--timeout", "50ms", "--interval", "10ms"],
    {
      cwd: root,
      env: { ...environment, YARU_NOW: "2026-09-28T12:00:00.000Z" },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const finished = await Promise.race([
    waiting.exited.then((code) => ({ code, timedOut: false })),
    Bun.sleep(1_000).then(() => ({ code: null, timedOut: true })),
  ])
  if (finished.timedOut) waiting.kill()
  expect(finished.timedOut).toBe(false)
  expect(finished.code).toBe(2)
  expect(performance.now() - started).toBeLessThan(1_000)
  const result = JSON.parse(await new Response(waiting.stdout).text())
  expect(result.status).toBe("open")
  expect(result.acknowledgedAt).toBeNull()
})

test("issue save stops when YARU_NOW is not a datetime", () => {
  const root = workspace()
  const out = run(["issue", "save", "--title", "frozen clock"], root, undefined, {
    YARU_NOW: "yesterday",
  })
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain(
    'invalid YARU_NOW: expected an ISO 8601 datetime such as 2026-09-28T12:00:00.000Z, actual "yesterday"',
  )
  expect(existsSync(join(root, ".yaru", "issues", "1.md"))).toBe(false)
})
