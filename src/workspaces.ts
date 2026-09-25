import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

// 1 つの yaru serve で全プロジェクトを見るため、yaru を使ったワークスペースを覚えておく
// 人が登録しなくて済むよう、CLI がワークスペースを開くたびに自動で登録する
// 置き場所は設定ではなく状態なので XDG の state ディレクトリに置く
// https://specifications.freedesktop.org/basedir-spec/latest/

export type Workspace = {
  // URL の /p/<slug>/ に使う名前。一度決めたら変えない
  slug: string
  root: string
}

type Registry = { workspaces: Workspace[] }

export function stateDirectory(): string {
  if (process.env.YARU_STATE_DIR) return process.env.YARU_STATE_DIR
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(base, "yaru")
}

export function registerWorkspace(root: string, directory = stateDirectory()): Workspace {
  const registry = readRegistry(directory)
  const existing = registry.workspaces.find((workspace) => workspace.root === root)
  if (existing) return existing
  const base = slugify(basename(root))
  const taken = new Set(registry.workspaces.map((workspace) => workspace.slug))
  let slug = base
  for (let suffix = 2; taken.has(slug); suffix++) slug = `${base}-${suffix}`
  const workspace = { slug, root }
  registry.workspaces.push(workspace)
  mkdirSync(directory, { recursive: true })
  const path = registryPath(directory)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`)
  renameSync(temporary, path)
  return workspace
}

// .yaru を消したワークスペースは一覧から外す。登録からは消さず、名前を再利用しない
export function listWorkspaces(directory = stateDirectory()): Workspace[] {
  return readRegistry(directory).workspaces.filter((workspace) =>
    existsSync(join(workspace.root, ".yaru", "config.yml")),
  )
}

export function findWorkspace(slug: string, directory = stateDirectory()): Workspace | null {
  return listWorkspaces(directory).find((workspace) => workspace.slug === slug) ?? null
}

function registryPath(directory: string): string {
  return join(directory, "workspaces.json")
}

function readRegistry(directory: string): Registry {
  const path = registryPath(directory)
  if (!existsSync(path)) return { workspaces: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Registry>
    return {
      workspaces: (parsed.workspaces ?? []).filter(
        (workspace): workspace is Workspace =>
          typeof workspace?.slug === "string" && typeof workspace?.root === "string",
      ),
    }
  } catch {
    // 壊れた登録ファイルで CLI 全体を止めない。次の登録で作り直される
    return { workspaces: [] }
  }
}

function slugify(name: string): string {
  const slug = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return slug || "workspace"
}
