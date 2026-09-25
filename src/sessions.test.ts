import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { claudeProjectDirectory, readSessionHealth } from "./sessions"

const dirs: string[] = []

function home() {
  const directory = mkdtempSync(join(tmpdir(), "yaru-sessions-"))
  dirs.push(directory)
  return directory
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const NOW = new Date("2026-09-25T12:00:00.000Z")
const ROOT = "/Users/someone/ghq/github.com/org/app"

function assistant(
  id: string,
  timestamp: string,
  usage: Record<string, unknown>,
  model = "claude-opus-5-5",
  content: unknown[] = [{ type: "text", text: "x" }],
) {
  return { type: "assistant", timestamp, message: { id, model, usage, content } }
}

function toolResult(timestamp: string, isError: boolean) {
  return {
    type: "user",
    timestamp,
    message: { content: [{ type: "tool_result", tool_use_id: "t", is_error: isError }] },
  }
}

function writeSession(directory: string, name: string, lines: unknown[], modified = NOW) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n")
  utimesSync(path, modified, modified)
  return path
}

describe("sessions", () => {
  test("the project directory replaces slashes and dots with hyphens like Claude Code does", () => {
    expect(claudeProjectDirectory(ROOT, "/home/me")).toBe(
      "/home/me/.claude/projects/-Users-someone-ghq-github-com-org-app",
    )
  })

  test("a workspace without Claude Code logs reports no directory and no sessions", () => {
    const health = readSessionHealth(ROOT, { home: home(), now: NOW })
    expect(health.directory).toBeNull()
    expect(health.sessions).toEqual([])
    expect(health.totals.costUsd).toBe(0)
  })

  test("sums usage once per message id, prices it per model, and reads the title", () => {
    const homeDirectory = home()
    const projectDirectory = claudeProjectDirectory(ROOT, homeDirectory)
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 2_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 },
    }
    writeSession(projectDirectory, "s1.jsonl", [
      { type: "user", timestamp: "2026-09-25T10:00:00.000Z", message: { content: "hello" } },
      assistant("m1", "2026-09-25T10:00:01.000Z", usage),
      // Claude Code は 1 つの応答を content block ごとに複数行へ書き、同じ usage を繰り返す
      assistant("m1", "2026-09-25T10:00:02.000Z", usage),
      { type: "ai-title", aiTitle: "first title" },
      { type: "ai-title", aiTitle: "latest title" },
    ])
    const health = readSessionHealth(ROOT, { home: homeDirectory, now: NOW })
    expect(health.directory).toBe(projectDirectory)
    expect(health.sessions).toHaveLength(1)
    const session = health.sessions[0]!
    expect(session).toMatchObject({
      id: "s1",
      title: "latest title",
      startedAt: "2026-09-25T10:00:00.000Z",
      lastActivityAt: "2026-09-25T10:00:02.000Z",
      models: ["claude-opus-5-5"],
      assistantMessages: 1,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 2_000_000,
      cacheCreationTokens: 1_000_000,
      unpricedMessages: 0,
    })
    // opus 5.5: input 4 + output 20 + cache read 0.2 x 2 + 1 時間の cache write 4 x 2 x 1
    expect(session.costUsd).toBeCloseTo(4 + 20 + 0.4 + 8, 6)
    expect(health.totals.cacheReadRatio).toBeCloseTo(2 / 4, 6)
  })

  test("counts tool errors, interruptions, and subagent usage into the parent session", () => {
    const homeDirectory = home()
    const projectDirectory = claudeProjectDirectory(ROOT, homeDirectory)
    const small = { input_tokens: 100, output_tokens: 10 }
    writeSession(projectDirectory, "s1.jsonl", [
      assistant("m1", "2026-09-25T10:00:00.000Z", small, "claude-opus-5-5", [
        { type: "tool_use", id: "t", name: "Bash", input: {} },
        { type: "tool_use", id: "u", name: "Read", input: {} },
      ]),
      toolResult("2026-09-25T10:00:01.000Z", false),
      toolResult("2026-09-25T10:00:02.000Z", true),
      {
        type: "user",
        timestamp: "2026-09-25T10:00:03.000Z",
        message: { content: [{ type: "text", text: "[Request interrupted by user]" }] },
      },
    ])
    writeSession(join(projectDirectory, "s1", "subagents", "workflows"), "agent-a.jsonl", [
      assistant("m2", "2026-09-25T10:05:00.000Z", small, "claude-sonnet-5"),
      toolResult("2026-09-25T10:05:01.000Z", true),
    ])
    const session = readSessionHealth(ROOT, { home: homeDirectory, now: NOW }).sessions[0]!
    expect(session).toMatchObject({
      toolUses: 2,
      toolResults: 3,
      toolErrors: 2,
      interruptions: 1,
      subagents: 1,
      assistantMessages: 2,
      inputTokens: 200,
      lastActivityAt: "2026-09-25T10:05:01.000Z",
      models: ["claude-opus-5-5", "claude-sonnet-5"],
    })
  })

  test("unknown models are counted as unpriced instead of guessed", () => {
    const homeDirectory = home()
    const projectDirectory = claudeProjectDirectory(ROOT, homeDirectory)
    writeSession(projectDirectory, "s1.jsonl", [
      assistant(
        "m1",
        "2026-09-25T10:00:00.000Z",
        { input_tokens: 5, output_tokens: 5 },
        "claude-future-9",
      ),
      assistant(
        "m2",
        "2026-09-25T10:00:01.000Z",
        { input_tokens: 5, output_tokens: 5 },
        "<synthetic>",
      ),
    ])
    const session = readSessionHealth(ROOT, { home: homeDirectory, now: NOW }).sessions[0]!
    expect(session.costUsd).toBe(0)
    expect(session.unpricedMessages).toBe(1)
    expect(session.models).toEqual(["claude-future-9"])
  })

  test("a dated snapshot id is priced as its model", () => {
    const homeDirectory = home()
    const projectDirectory = claudeProjectDirectory(ROOT, homeDirectory)
    writeSession(projectDirectory, "s1.jsonl", [
      assistant(
        "m1",
        "2026-09-25T10:00:00.000Z",
        { input_tokens: 1_000_000, output_tokens: 0 },
        "claude-haiku-4-5-20251001",
      ),
    ])
    const session = readSessionHealth(ROOT, { home: homeDirectory, now: NOW }).sessions[0]!
    expect(session.costUsd).toBeCloseTo(1, 6)
    expect(session.unpricedMessages).toBe(0)
  })

  test("fast mode doubles the price", () => {
    const homeDirectory = home()
    const projectDirectory = claudeProjectDirectory(ROOT, homeDirectory)
    writeSession(projectDirectory, "s1.jsonl", [
      assistant("m1", "2026-09-25T10:00:00.000Z", {
        input_tokens: 1_000_000,
        output_tokens: 0,
        speed: "fast",
      }),
    ])
    expect(
      readSessionHealth(ROOT, { home: homeDirectory, now: NOW }).sessions[0]!.costUsd,
    ).toBeCloseTo(8, 6)
  })

  test("only sessions modified inside the window are read, newest activity first", () => {
    const homeDirectory = home()
    const projectDirectory = claudeProjectDirectory(ROOT, homeDirectory)
    const usage = { input_tokens: 1, output_tokens: 1 }
    writeSession(
      projectDirectory,
      "old.jsonl",
      [assistant("m0", "2026-09-01T00:00:00.000Z", usage)],
      new Date("2026-09-01T00:00:00.000Z"),
    )
    writeSession(projectDirectory, "a.jsonl", [assistant("m1", "2026-09-24T00:00:00.000Z", usage)])
    writeSession(projectDirectory, "b.jsonl", [assistant("m2", "2026-09-25T00:00:00.000Z", usage)])
    const health = readSessionHealth(ROOT, { home: homeDirectory, now: NOW, windowDays: 7 })
    expect(health.sessions.map((session) => session.id)).toEqual(["b", "a"])
    expect(health.windowDays).toBe(7)
  })

  test("broken lines are skipped without hiding the rest of the session", () => {
    const homeDirectory = home()
    const projectDirectory = claudeProjectDirectory(ROOT, homeDirectory)
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(
      join(projectDirectory, "s1.jsonl"),
      `{"type":"assistant",\n${JSON.stringify(assistant("m1", "2026-09-25T10:00:00.000Z", { input_tokens: 7, output_tokens: 1 }))}\n`,
    )
    expect(
      readSessionHealth(ROOT, { home: homeDirectory, now: NOW }).sessions[0]!.inputTokens,
    ).toBe(7)
  })
})
