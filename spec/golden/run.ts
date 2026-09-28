import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, isAbsolute, join, relative, sep } from "node:path"

// 実行のたびに変わる一時ディレクトリを、記録の中では固定の置き換え文字にする
// macOS では /tmp や /var が /private 付きの実パスになるので、両方を同じ文字へ寄せる

export type WorktreeBinding = {
  name: string
  directory: string
}

export type NormalizationBindings = {
  workspaceDirectory: string
  stateDirectory: string
  worktrees: WorktreeBinding[]
  // bun の診断がリポジトリの絶対パスを出すことがある。チェックアウト先が違っても記録がずれないようにする
  repositoryDirectory?: string
}

const WORKSPACE_PLACEHOLDER = "<WORKSPACE>"
const STATE_PLACEHOLDER = "<STATE>"

export function normalizeText(text: string, bindings: NormalizationBindings): string {
  const replacements: { from: string; to: string }[] = []
  for (const variant of pathVariants(bindings.workspaceDirectory)) {
    replacements.push({ from: variant, to: WORKSPACE_PLACEHOLDER })
  }
  for (const variant of pathVariants(bindings.stateDirectory)) {
    replacements.push({ from: variant, to: STATE_PLACEHOLDER })
  }
  for (const worktree of bindings.worktrees) {
    for (const variant of pathVariants(worktree.directory)) {
      replacements.push({ from: variant, to: `<WORKTREE:${worktree.name}>` })
    }
  }
  if (bindings.repositoryDirectory !== undefined) {
    for (const variant of pathVariants(bindings.repositoryDirectory)) {
      replacements.push({ from: variant, to: "<REPOSITORY>" })
    }
  }
  // 作業ツリーのパスがワークスペースのパスを含むとき、短い方を先に替えると長い方が壊れる
  replacements.sort((left, right) => right.from.length - left.from.length)
  let normalized = text
  for (const replacement of replacements) {
    if (replacement.from.length < 2) continue
    normalized = normalized.split(replacement.from).join(replacement.to)
  }
  return normalized
}

export type RecordedFile = {
  path: string
  content: string
}

export type RecordedStep = {
  arguments: string[]
  stdout: string
  stderr: string
  exitCode: number
}

export type Snapshot = {
  name: string
  steps: RecordedStep[]
  yaru: RecordedFile[]
  state: RecordedFile[]
}

export type Difference = {
  scenario: string
  location: string
  detail: string
}

export function compareSnapshots(expected: Snapshot, actual: Snapshot): Difference[] {
  const scenario = expected.name
  const differences: Difference[] = []
  const stepCount = Math.max(expected.steps.length, actual.steps.length)
  for (let index = 0; index < stepCount; index++) {
    const expectedStep = expected.steps[index]
    const actualStep = actual.steps[index]
    const location = stepLocation(index, expectedStep ?? actualStep)
    if (!expectedStep || !actualStep) {
      differences.push({
        scenario,
        location,
        detail: expectedStep ? "missing in actual" : "unexpected step",
      })
      continue
    }
    if (expectedStep.stdout !== actualStep.stdout) {
      differences.push({
        scenario,
        location: `${location}: stdout`,
        detail: unifiedDiff(expectedStep.stdout, actualStep.stdout),
      })
    }
    if (expectedStep.stderr !== actualStep.stderr) {
      differences.push({
        scenario,
        location: `${location}: stderr`,
        detail: unifiedDiff(expectedStep.stderr, actualStep.stderr),
      })
    }
    if (expectedStep.exitCode !== actualStep.exitCode) {
      differences.push({
        scenario,
        location: `${location}: exit code`,
        detail: `expected ${expectedStep.exitCode}, actual ${actualStep.exitCode}`,
      })
    }
  }
  differences.push(...compareFiles(scenario, ".yaru", expected.yaru, actual.yaru))
  differences.push(...compareFiles(scenario, "state", expected.state, actual.state))
  return differences
}

export function formatDifferences(differences: Difference[]): string {
  if (differences.length === 0) return ""
  const lines: string[] = []
  let currentScenario = ""
  for (const difference of differences) {
    if (difference.scenario !== currentScenario) {
      currentScenario = difference.scenario
      lines.push(`scenario ${currentScenario}`)
    }
    lines.push(`  ${difference.location}`)
    for (const line of difference.detail.split("\n")) lines.push(`    ${line}`)
  }
  return `${lines.join("\n")}\n`
}

function stepLocation(index: number, step: RecordedStep | undefined): string {
  const command = step ? step.arguments.join(" ") : ""
  return `step ${index + 1} (${command})`
}

function compareFiles(
  scenario: string,
  root: string,
  expected: RecordedFile[],
  actual: RecordedFile[],
): Difference[] {
  const differences: Difference[] = []
  const actualByPath = new Map(actual.map((file) => [file.path, file]))
  const expectedPaths = new Set(expected.map((file) => file.path))
  for (const file of expected) {
    const found = actualByPath.get(file.path)
    const location = `${root}/${file.path}`
    if (!found) {
      differences.push({ scenario, location, detail: "missing in actual" })
      continue
    }
    if (found.content !== file.content) {
      differences.push({
        scenario,
        location,
        detail: unifiedDiff(file.content, found.content),
      })
    }
  }
  for (const file of actual) {
    if (expectedPaths.has(file.path)) continue
    differences.push({
      scenario,
      location: `${root}/${file.path}`,
      detail: "unexpected file",
    })
  }
  return differences
}

function unifiedDiff(expected: string, actual: string): string {
  const expectedLines = expected.split("\n")
  const actualLines = actual.split("\n")
  const output = ["--- expected", "+++ actual"]
  const limit = Math.max(expectedLines.length, actualLines.length)
  let shown = 0
  for (let index = 0; index < limit; index++) {
    const left = expectedLines[index]
    const right = actualLines[index]
    if (left === right) continue
    if (shown >= 40) {
      output.push("... diff truncated")
      break
    }
    if (left !== undefined) output.push(`-${left}`)
    if (right !== undefined) output.push(`+${right}`)
    shown += 1
  }
  return output.join("\n")
}

function pathVariants(directory: string): string[] {
  const variants = new Set<string>()
  variants.add(directory)
  try {
    variants.add(realpathSync(directory))
  } catch {
    // まだ無いディレクトリは渡された表記だけを置き換える
  }
  for (const path of [...variants]) {
    if (path.startsWith("/private/")) variants.add(path.slice("/private".length))
    else if (path.startsWith("/")) variants.add(`/private${path}`)
  }
  return [...variants]
}

// 場面と記録は JSON。Go 版も同じファイルを読む
// https://www.rfc-editor.org/rfc/rfc8259

export type ScenarioFile = {
  name: string
  description: string
  setup?: ScenarioSetup
  steps: ScenarioStep[]
}

export type ScenarioSetup = {
  files?: { path: string; content: string }[]
  commits?: { message: string; paths?: string[] }[]
  worktrees?: { name: string; branch: string }[]
  gitUser?: { name: string; email: string }
}

export type ScenarioStep = {
  arguments: string[]
  stdin?: string
  environment?: Record<string, string>
  // ISO 8601 の日時 (RFC 3339)。CLI の YARU_NOW にそのまま渡す
  // https://www.rfc-editor.org/rfc/rfc3339#section-5.6
  now?: string
  // "." はワークスペースの根。worktree:<名前> は準備で作った linked worktree
  workingDirectory?: string
}

const PASSED_ENVIRONMENT = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
] as const

const DEFAULT_GIT_USER = { name: "golden", email: "golden@example.com" }
// 準備の commit の時刻を固定し、作者の日付が記録に混ざらないようにする
const SETUP_COMMIT_DATE = "2026-09-28T00:00:00Z"
const SCENARIO_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function repositoryRoot(): string {
  return join(import.meta.dir, "..", "..")
}

export function cliCommand(repositoryDirectory: string): string[] {
  const bin = process.env.YARU_BIN
  if (bin !== undefined && bin !== "") return [bin]
  // Bun は JSX の変換設定を作業ディレクトリの tsconfig からしか読まない。
  // リポジトリの外で src/index.ts を動かすと preact ではなく react/jsx-dev-runtime を探す
  return ["bun", "--jsx-import-source=preact", join(repositoryDirectory, "src", "index.ts")]
}

export async function runScenario(scenario: ScenarioFile): Promise<Snapshot> {
  const parent = mkdtempSync(join(tmpdir(), "yaru-golden-"))
  mkdirSync(join(parent, "workspace"))
  mkdirSync(join(parent, "state"))
  // git は実パスを返す。spawn に渡すパスと揃えないと、登録ファイルに同じ場所が 2 行出る
  const workspaceDirectory = realpathSync(join(parent, "workspace"))
  const stateDirectory = realpathSync(join(parent, "state"))
  try {
    assertIsolated(workspaceDirectory)
    assertIsolated(stateDirectory)
    const worktrees = prepareWorkspace(workspaceDirectory, scenario.setup)
    const bindings = bindingsFor(workspaceDirectory, stateDirectory, worktrees)
    const steps: RecordedStep[] = []
    for (const step of scenario.steps) {
      const workingDirectory = resolveWorkingDirectory(
        workspaceDirectory,
        worktrees,
        step.workingDirectory,
      )
      const result = Bun.spawnSync([...cliCommand(repositoryRoot()), ...step.arguments], {
        cwd: workingDirectory,
        env: childEnvironment(stateDirectory, step),
        stdin: Buffer.from(step.stdin ?? ""),
        stdout: "pipe",
        stderr: "pipe",
      })
      if (result.exitCode === null) {
        throw new Error("command did not exit: expected an exit code, actual none")
      }
      steps.push({
        arguments: step.arguments,
        stdout: normalizeText(result.stdout.toString(), bindings),
        stderr: normalizeText(result.stderr.toString(), bindings),
        exitCode: result.exitCode,
      })
    }
    return {
      name: scenario.name,
      steps,
      yaru: readTree(join(workspaceDirectory, ".yaru"), bindings),
      state: readTree(stateDirectory, bindings),
    }
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
}

export async function execute(
  argv: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const options = parseRunnerArguments(argv)
    const scenarios = loadScenarios(options.scenariosDirectory)
    const selected = selectScenarios(scenarios, options.names)
    if (options.mode === "update") {
      mkdirSync(options.snapshotsDirectory, { recursive: true })
      const lines: string[] = []
      for (const scenario of selected) {
        const snapshot = await runScenario(scenario)
        const path = join(options.snapshotsDirectory, `${scenario.name}.json`)
        writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`)
        lines.push(`updated ${path}`)
      }
      return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" }
    }
    const differences: Difference[] = []
    for (const scenario of selected) {
      const path = join(options.snapshotsDirectory, `${scenario.name}.json`)
      if (!existsSync(path)) {
        differences.push({
          scenario: scenario.name,
          location: "snapshot",
          detail: `missing snapshot: expected ${path}, actual file not found`,
        })
        continue
      }
      differences.push(...compareSnapshots(readSnapshot(path), await runScenario(scenario)))
    }
    if (options.names.length === 0) {
      differences.push(...unexpectedSnapshots(scenarios, options.snapshotsDirectory))
    }
    if (differences.length > 0) {
      return { exitCode: 1, stdout: "", stderr: formatDifferences(differences) }
    }
    return { exitCode: 0, stdout: `checked ${selected.length} scenario(s)\n`, stderr: "" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 1, stdout: "", stderr: `${message}\n` }
  }
}

function bindingsFor(
  workspaceDirectory: string,
  stateDirectory: string,
  worktrees: WorktreeBinding[],
): NormalizationBindings {
  return {
    workspaceDirectory,
    stateDirectory,
    worktrees,
    repositoryDirectory: realpathSync(repositoryRoot()),
  }
}

function prepareWorkspace(
  workspaceDirectory: string,
  setup: ScenarioSetup | undefined,
): WorktreeBinding[] {
  git(workspaceDirectory, ["init", "--quiet", "--initial-branch", "main"])
  const gitUser = setup?.gitUser ?? DEFAULT_GIT_USER
  git(workspaceDirectory, ["config", "user.name", gitUser.name])
  git(workspaceDirectory, ["config", "user.email", gitUser.email])
  for (const file of setup?.files ?? []) {
    const destination = resolveInside(workspaceDirectory, file.path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, file.content)
  }
  const commits = setup?.commits ?? []
  for (const commit of commits) {
    const paths = commit.paths ?? ["."]
    for (const path of paths) resolveInside(workspaceDirectory, path === "." ? "." : path)
    git(workspaceDirectory, ["add", "--", ...paths])
    git(
      workspaceDirectory,
      ["commit", "--quiet", "--allow-empty", "-m", commit.message],
      commitEnvironment(gitUser),
    )
  }
  const worktrees: WorktreeBinding[] = []
  for (const worktree of setup?.worktrees ?? []) {
    if (commits.length === 0) {
      throw new Error(`worktree ${worktree.name}: expected at least one commit, actual none`)
    }
    if (!SCENARIO_NAME.test(worktree.name)) {
      throw new Error(
        `invalid worktree name: expected lowercase words separated by hyphens, actual ${JSON.stringify(worktree.name)}`,
      )
    }
    const directory = join(dirname(workspaceDirectory), "worktrees", worktree.name)
    mkdirSync(dirname(directory), { recursive: true })
    git(workspaceDirectory, ["worktree", "add", "--quiet", "-b", worktree.branch, directory])
    worktrees.push({ name: worktree.name, directory: realpathSync(directory) })
  }
  return worktrees
}

function commitEnvironment(gitUser: { name: string; email: string }): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: gitUser.name,
    GIT_AUTHOR_EMAIL: gitUser.email,
    GIT_COMMITTER_NAME: gitUser.name,
    GIT_COMMITTER_EMAIL: gitUser.email,
    GIT_AUTHOR_DATE: SETUP_COMMIT_DATE,
    GIT_COMMITTER_DATE: SETUP_COMMIT_DATE,
  }
}

function resolveWorkingDirectory(
  workspaceDirectory: string,
  worktrees: WorktreeBinding[],
  workingDirectory: string | undefined,
): string {
  if (workingDirectory === undefined || workingDirectory === ".") return workspaceDirectory
  if (workingDirectory.startsWith("worktree:")) {
    const name = workingDirectory.slice("worktree:".length)
    const found = worktrees.find((worktree) => worktree.name === name)
    if (!found) {
      const names = worktrees.map((worktree) => worktree.name).join(", ") || "(none)"
      throw new Error(`unknown worktree: expected one of ${names}, actual ${JSON.stringify(name)}`)
    }
    return found.directory
  }
  return resolveInside(workspaceDirectory, workingDirectory)
}

function resolveInside(root: string, relativePath: string): string {
  if (relativePath === ".") return root
  if (relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error(
      `invalid path: expected a relative path, actual ${JSON.stringify(relativePath)}`,
    )
  }
  const resolved = join(root, relativePath)
  const relativeToRoot = relative(root, resolved)
  if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
    throw new Error(
      `invalid path: expected a path inside the workspace, actual ${JSON.stringify(relativePath)}`,
    )
  }
  return resolved
}

// 親の環境は渡さない。セッション ID や YARU_STATE_DIR が記録のたびに変わると、同じ場面でも golden がずれる
function childEnvironment(stateDirectory: string, step: ScenarioStep): Record<string, string> {
  if (
    step.environment &&
    Object.prototype.hasOwnProperty.call(step.environment, "YARU_STATE_DIR")
  ) {
    throw new Error(
      "invalid environment: expected no YARU_STATE_DIR, actual the step sets YARU_STATE_DIR",
    )
  }
  const environment = baseEnvironment()
  for (const [key, value] of Object.entries(step.environment ?? {})) environment[key] = value
  if (
    step.now !== undefined &&
    step.environment?.YARU_NOW !== undefined &&
    step.environment.YARU_NOW !== step.now
  ) {
    throw new Error(
      `invalid now: expected YARU_NOW to match now, actual environment ${JSON.stringify(step.environment.YARU_NOW)} and now ${JSON.stringify(step.now)}`,
    )
  }
  if (step.now !== undefined) environment.YARU_NOW = step.now
  environment.YARU_STATE_DIR = stateDirectory
  return environment
}

function baseEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const key of PASSED_ENVIRONMENT) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  return environment
}

function git(
  workingDirectory: string,
  args: string[],
  extraEnvironment: Record<string, string> = {},
): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: workingDirectory,
    env: { ...baseEnvironment(), ...extraEnvironment },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: expected exit code 0, actual ${result.exitCode ?? "signal"} ${result.stderr.toString().trim()}`,
    )
  }
}

function readTree(root: string, bindings: NormalizationBindings): RecordedFile[] {
  if (!existsSync(root)) return []
  const files: RecordedFile[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`unexpected symlink: expected a regular file, actual ${absolute}`)
      }
      if (entry.isDirectory()) {
        visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const portablePath = relative(root, absolute).split(sep).join("/")
      files.push({
        path: portablePath,
        content: normalizeText(readFileSync(absolute, "utf8"), bindings),
      })
    }
  }
  visit(root)
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return files
}

function assertIsolated(directory: string): void {
  const resolved = realpathSync(directory)
  const repository = realpathSync(repositoryRoot())
  if (isInside(repository, resolved)) {
    throw new Error(
      `refusing to touch the repository: expected a temp directory, actual ${resolved}`,
    )
  }
  const stateHome = join(homedir(), ".local", "state")
  if (existsSync(stateHome)) {
    const resolvedState = realpathSync(stateHome)
    if (isInside(resolvedState, resolved)) {
      throw new Error(
        `refusing to touch the real state directory: expected a temp directory, actual ${resolved}`,
      )
    }
  }
}

function isInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

type RunnerOptions = {
  mode: "check" | "update"
  scenariosDirectory: string
  snapshotsDirectory: string
  names: string[]
}

function parseRunnerArguments(argv: string[]): RunnerOptions {
  let mode: "check" | "update" | undefined
  let scenariosDirectory = join(import.meta.dir, "scenarios")
  let snapshotsDirectory = join(import.meta.dir, "snapshots")
  const names: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    if (argument === "--check" || argument === "--update") {
      if (mode) {
        throw new Error("invalid arguments: expected one of --check or --update, actual both")
      }
      mode = argument === "--check" ? "check" : "update"
      continue
    }
    if (argument === "--scenarios" || argument === "--snapshots") {
      const value = argv[index + 1]
      if (value === undefined) {
        throw new Error(`invalid arguments: expected a directory after ${argument}, actual none`)
      }
      index += 1
      if (argument === "--scenarios") scenariosDirectory = value
      else snapshotsDirectory = value
      continue
    }
    if (argument.startsWith("-")) {
      throw new Error(`unknown argument: expected --check or --update, actual ${argument}`)
    }
    names.push(argument)
  }
  if (!mode) throw new Error("invalid arguments: expected --check or --update, actual none")
  return { mode, scenariosDirectory, snapshotsDirectory, names }
}

function loadScenarios(directory: string): ScenarioFile[] {
  if (!existsSync(directory)) {
    throw new Error(
      `scenarios directory not found: expected a directory, actual ${JSON.stringify(directory)}`,
    )
  }
  const scenarios: ScenarioFile[] = []
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith(".json")) continue
    const scenario = JSON.parse(readFileSync(join(directory, name), "utf8")) as ScenarioFile
    const expectedName = name.slice(0, -".json".length)
    if (scenario.name !== expectedName) {
      throw new Error(
        `invalid scenario name: expected ${expectedName}, actual ${JSON.stringify(scenario.name)}`,
      )
    }
    if (!SCENARIO_NAME.test(scenario.name)) {
      throw new Error(
        `invalid scenario name: expected lowercase words separated by hyphens, actual ${JSON.stringify(scenario.name)}`,
      )
    }
    if (typeof scenario.description !== "string" || scenario.description.trim() === "") {
      throw new Error(
        `invalid scenario description: expected a non-empty string, actual ${JSON.stringify(scenario.description)}`,
      )
    }
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
      throw new Error("invalid scenario steps: expected a non-empty array, actual empty")
    }
    for (const step of scenario.steps) {
      if (
        !Array.isArray(step.arguments) ||
        step.arguments.some((argument) => typeof argument !== "string")
      ) {
        throw new Error(
          `invalid step arguments: expected an array of strings, actual ${JSON.stringify(step.arguments)}`,
        )
      }
    }
    scenarios.push(scenario)
  }
  return scenarios
}

function selectScenarios(scenarios: ScenarioFile[], names: string[]): ScenarioFile[] {
  if (names.length === 0) return scenarios
  const known = new Set(scenarios.map((scenario) => scenario.name))
  for (const name of names) {
    if (known.has(name)) continue
    throw new Error(
      `unknown scenario: expected one of ${[...known].join(", ") || "(none)"}, actual ${name}`,
    )
  }
  return scenarios.filter((scenario) => names.includes(scenario.name))
}

function readSnapshot(path: string): Snapshot {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Snapshot
  if (typeof parsed?.name !== "string" || !Array.isArray(parsed.steps)) {
    throw new Error(`invalid snapshot: expected name and steps, actual ${path}`)
  }
  parsed.yaru ??= []
  parsed.state ??= []
  return parsed
}

function unexpectedSnapshots(scenarios: ScenarioFile[], snapshotsDirectory: string): Difference[] {
  if (!existsSync(snapshotsDirectory)) return []
  const scenarioNames = new Set(scenarios.map((scenario) => scenario.name))
  const differences: Difference[] = []
  for (const name of readdirSync(snapshotsDirectory)) {
    if (!name.endsWith(".json")) continue
    const scenarioName = name.slice(0, -".json".length)
    if (scenarioNames.has(scenarioName)) continue
    differences.push({
      scenario: scenarioName,
      location: "snapshot",
      detail: `unexpected snapshot: expected no file, actual ${name}`,
    })
  }
  return differences
}

if (import.meta.main) {
  const result = await execute(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
