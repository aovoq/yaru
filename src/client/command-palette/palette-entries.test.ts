import { describe, expect, test } from "bun:test"
import { BLANK } from "../../page"
import type { Issue } from "../../store"
import { paletteEntries, type PaletteInput } from "./palette-entries"

const issues: Issue[] = [
  { ...BLANK, id: "73", title: "地図の配色", status: "todo", updatedAt: "2026-09-20T00:00:00Z" },
  { ...BLANK, id: "7", title: "称号 73 件を片付ける", updatedAt: "2026-09-25T00:00:00Z" },
  { ...BLANK, id: "12", title: "通知", status: "done", updatedAt: "2026-09-10T00:00:00Z" },
]

function input(overrides: Partial<PaletteInput> = {}): PaletteInput {
  return {
    query: "",
    all: issues,
    awaitingByIssue: {},
    workspaces: [],
    basePath: "/p/app",
    target: null,
    issueHref: (issueId) => `/p/app/?id=${issueId}`,
    boardUrl: "http://host/p/app/",
    now: new Date(2026, 8, 25),
    ...overrides,
  }
}

const labels = (overrides: Partial<PaletteInput>) =>
  paletteEntries(input(overrides)).map((entry) => entry.label)

describe("command palette entries", () => {
  test("an issue number puts that issue first, before titles that contain the number", () => {
    const entries = paletteEntries(input({ query: "#73" })).filter(
      (entry) => entry.group === "Issues",
    )
    expect(entries.map((entry) => entry.detail)).toEqual(["#73", "#7"])
    expect(entries[0]!.command).toEqual({ type: "navigate", href: "/p/app/?id=73" })
  })

  test("assign to me uses the viewer's name and is left out when the target is already theirs", () => {
    const target = { ...issues[0]!, assignee: null }
    const assign = paletteEntries(input({ target, query: "assign to me", viewer: "aovoq" })).find(
      (entry) => entry.label === "Assignee: Assign to me (aovoq)",
    )
    expect(assign?.command).toEqual({
      type: "menu",
      action: { type: "save", issueId: "73", input: { assignee: "aovoq" } },
    })
    const mine = { ...issues[0]!, assignee: "aovoq" }
    expect(labels({ target: mine, query: "assign to me", viewer: "aovoq" })).toEqual([])
  })

  test("titles are searched without regard to case, and recent issues show with no query", () => {
    expect(labels({ query: "通知" })).toContain("通知")
    const recent = paletteEntries(input()).filter((entry) => entry.group === "Issues")
    expect(recent.map((entry) => entry.detail)).toEqual(["#7", "#73", "#12"])
  })

  test("awaiting questions list issues that can still be answered before expired ones", () => {
    const entries = paletteEntries(
      input({
        awaitingByIssue: {
          "12": { count: 1, expired: 1, soonestAnswerBy: null },
          "73": { count: 2, expired: 0, soonestAnswerBy: "2026-09-26T00:00:00Z" },
        },
      }),
    ).filter((entry) => entry.group === "Awaiting answers")
    expect(entries.map((entry) => entry.label)).toEqual([
      "Answer 2 questions on 地図の配色",
      "Answer question on 通知",
    ])
  })

  test("other workspaces can be switched to with a full page navigation, plus the inbox", () => {
    const entries = paletteEntries(
      input({
        workspaces: [
          { slug: "app", basePath: "/p/app", awaiting: 0 },
          { slug: "AsukaTravel", basePath: "/p/AsukaTravel", awaiting: 3 },
        ],
      }),
    )
    const switches = entries.filter((entry) => entry.group === "Workspaces")
    expect(switches).toEqual([
      {
        key: "workspace-AsukaTravel",
        group: "Workspaces",
        label: "Switch to AsukaTravel",
        detail: "3 awaiting",
        command: { type: "location", href: "/p/AsukaTravel/" },
      },
    ])
    expect(entries.find((entry) => entry.label === "Open inbox")?.command).toEqual({
      type: "location",
      href: "/inbox",
    })
    expect(labels({})).not.toContain("Open inbox")
  })

  test("the target issue offers the context menu actions, property changes only when searched", () => {
    const target = issues[0]!
    const idle = labels({ target })
    expect(idle).toContain("Open issue")
    expect(idle).toContain("Copy link")
    expect(idle).not.toContain("Status: Done")
    const searched = paletteEntries(input({ target, query: "done" }))
    const done = searched.find((entry) => entry.label === "Status: Done")
    expect(done?.command).toEqual({
      type: "menu",
      action: { type: "save", issueId: "73", input: { status: "done" } },
    })
    // 今の値 (Todo) を選び直す候補は出さない
    expect(labels({ target, query: "status" })).not.toContain("Status: Todo")
  })

  test("going to the dashboard and creating an issue are always available", () => {
    const entries = paletteEntries(input({ query: "dash" }))
    expect(entries.map((entry) => entry.command)).toContainEqual({
      type: "location",
      href: "/p/app/dashboard",
    })
    expect(labels({ query: "create" })).toContain("Create issue")
  })
})
