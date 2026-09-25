import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { init } from "./store"
import { findWorkspace, listWorkspaces, registerWorkspace } from "./workspaces"

const dirs: string[] = []

function directory(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(path)
  return path
}

function workspaceAt(parent: string, name: string) {
  const root = join(parent, name)
  mkdirSync(root, { recursive: true })
  init(root)
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test("registering a workspace names it after its folder and is idempotent", () => {
  const state = directory("yaru-state-")
  const root = workspaceAt(directory("yaru-projects-"), "AsukaTravel")
  expect(registerWorkspace(root, state)).toEqual({ slug: "AsukaTravel", root })
  expect(registerWorkspace(root, state)).toEqual({ slug: "AsukaTravel", root })
  expect(listWorkspaces(state)).toEqual([{ slug: "AsukaTravel", root }])
  expect(JSON.parse(readFileSync(join(state, "workspaces.json"), "utf8"))).toEqual({
    workspaces: [{ slug: "AsukaTravel", root }],
  })
})

test("two folders with the same name get distinct names in registration order", () => {
  const state = directory("yaru-state-")
  const first = workspaceAt(directory("yaru-a-"), "app")
  const second = workspaceAt(directory("yaru-b-"), "app")
  registerWorkspace(first, state)
  registerWorkspace(second, state)
  expect(listWorkspaces(state).map((workspace) => workspace.slug)).toEqual(["app", "app-2"])
  expect(findWorkspace("app-2", state)?.root).toBe(second)
})

test("characters unsafe in a URL path become hyphens", () => {
  const state = directory("yaru-state-")
  const root = workspaceAt(directory("yaru-projects-"), "my project#1")
  expect(registerWorkspace(root, state).slug).toBe("my-project-1")
})

test("a workspace whose .yaru was removed is left out of the list", () => {
  const state = directory("yaru-state-")
  const root = workspaceAt(directory("yaru-projects-"), "gone")
  registerWorkspace(root, state)
  rmSync(join(root, ".yaru"), { recursive: true, force: true })
  expect(listWorkspaces(state)).toEqual([])
  expect(findWorkspace("gone", state)).toBeNull()
})

test("an empty state directory lists nothing", () => {
  expect(listWorkspaces(directory("yaru-state-"))).toEqual([])
})
