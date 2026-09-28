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

export type CommitBinding = {
  full: string
  short: string
}

export type NormalizationBindings = {
  workspaceDirectory: string
  stateDirectory: string
  worktrees: WorktreeBinding[]
  // bun の診断がリポジトリの絶対パスを出すことがある。チェックアウト先が違っても記録がずれないようにする
  repositoryDirectory?: string
  homeDirectory?: string
  // 準備で作った commit。40 桁と短縮形を、古い順に <COMMIT:1> から置き換える
  commits?: CommitBinding[]
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
  if (bindings.homeDirectory !== undefined) {
    for (const variant of pathVariants(bindings.homeDirectory)) {
      replacements.push({ from: variant, to: "<HOME>" })
    }
  }
  // 作業ツリーのパスがワークスペースのパスを含むとき、短い方を先に替えると長い方が壊れる
  replacements.sort((left, right) => right.from.length - left.from.length)
  let normalized = text
  for (const replacement of replacements) {
    if (replacement.from.length < 2) continue
    normalized = normalized.split(replacement.from).join(replacement.to)
  }
  return replaceCommits(normalized, bindings.commits ?? [])
}

function replaceCommits(text: string, commits: CommitBinding[]): string {
  let normalized = text
  // 完全なハッシュを先に消す。短縮形は別のハッシュの先頭にもなり得るので、境界を見てから替える
  for (const [index, commit] of commits.entries()) {
    normalized = replaceHash(normalized, commit.full, `<COMMIT:${index + 1}>`)
  }
  for (const [index, commit] of commits.entries()) {
    normalized = replaceHash(normalized, commit.short, `<COMMIT:${index + 1}>`)
  }
  return normalized
}

function replaceHash(text: string, hash: string, placeholder: string): string {
  if (!/^[0-9a-fA-F]{4,}$/.test(hash)) return text
  return text.replace(new RegExp(`(^|[^0-9a-fA-F])${hash}(?![0-9a-fA-F])`, "g"), `$1${placeholder}`)
}

export type RecordedFile = {
  path: string
  content: string
  directory?: boolean
}

export type RecordedStep = {
  arguments: string[]
  stdin?: string
  environment?: Record<string, string>
  now?: string
  workingDirectory?: string
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
    if ((expectedStep.stdin ?? "") !== (actualStep.stdin ?? "")) {
      differences.push({
        scenario,
        location: `${location}: stdin`,
        detail: unifiedDiff(expectedStep.stdin ?? "", actualStep.stdin ?? ""),
      })
    }
    if (environmentText(expectedStep.environment) !== environmentText(actualStep.environment)) {
      differences.push({
        scenario,
        location: `${location}: environment`,
        detail: unifiedDiff(
          environmentText(expectedStep.environment),
          environmentText(actualStep.environment),
        ),
      })
    }
    if ((expectedStep.now ?? "") !== (actualStep.now ?? "")) {
      differences.push({
        scenario,
        location: `${location}: now`,
        detail: `expected ${expectedStep.now ?? ""}, actual ${actualStep.now ?? ""}`,
      })
    }
    if ((expectedStep.workingDirectory ?? "") !== (actualStep.workingDirectory ?? "")) {
      differences.push({
        scenario,
        location: `${location}: workingDirectory`,
        detail: `expected ${expectedStep.workingDirectory ?? ""}, actual ${actualStep.workingDirectory ?? ""}`,
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
    if (Boolean(found.directory) !== Boolean(file.directory)) {
      differences.push({
        scenario,
        location,
        detail: `expected ${file.directory ? "a directory" : "a file"}, actual ${found.directory ? "a directory" : "a file"}`,
      })
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

function environmentText(environment: Record<string, string> | undefined): string {
  const source = environment ?? {}
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(source).sort()) sorted[key] = source[key]!
  return `${JSON.stringify(sorted, null, 2)}\n`
}

// Myers の最短編集から unified diff を作る。行番号で突き合わせると、1 行の挿入が後ろを全部差分にしてしまう
// 行末の空白と CR は画面では見えないので、その変更は JSON の文字列として出す
// https://www.gnu.org/software/diffutils/manual/html_node/Unified-Format.html
const DIFF_CONTEXT = 3

type Edit = { kind: "equal" | "delete" | "insert"; text: string }
type NumberedEdit = Edit & { expectedLine: number; actualLine: number }

function unifiedDiff(expected: string, actual: string): string {
  const edits = numberEdits(myersDiff(splitLines(expected), splitLines(actual)))
  const visible = edits.map((edit) => edit.kind !== "equal")
  for (let index = 0; index < edits.length; index++) {
    if (edits[index]!.kind === "equal") continue
    const from = Math.max(0, index - DIFF_CONTEXT)
    const to = Math.min(edits.length - 1, index + DIFF_CONTEXT)
    for (let cursor = from; cursor <= to; cursor++) visible[cursor] = true
  }
  const output = ["--- expected", "+++ actual"]
  let index = 0
  let shown = 0
  while (index < edits.length) {
    if (!visible[index]) {
      index += 1
      continue
    }
    let end = index
    while (end < edits.length && visible[end]) end += 1
    const hunk = edits.slice(index, end)
    output.push(hunkHeader(hunk))
    const rendered = renderHunk(hunk)
    for (const line of rendered) {
      if (shown >= 200) {
        output.push("... diff truncated")
        return output.join("\n")
      }
      output.push(line)
      shown += 1
    }
    index = end
  }
  // 行の中身は同じで末尾の改行だけが違うとき、hunk が空になるので目印を出す
  if (expected !== actual && !output.some((line) => isChangedLine(line))) {
    output.push("\\ No newline at end of file")
  }
  return output.join("\n")
}

function splitLines(text: string): string[] {
  if (text === "") return []
  const lines = text.split("\n")
  if (text.endsWith("\n")) lines.pop()
  return lines
}

function myersDiff(expected: string[], actual: string[]): Edit[] {
  const expectedLength = expected.length
  const actualLength = actual.length
  const max = expectedLength + actualLength
  const trace: Map<number, number>[] = []
  const furthest = new Map<number, number>()
  furthest.set(1, 0)
  for (let depth = 0; depth <= max; depth++) {
    trace.push(new Map(furthest))
    let reached = false
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const before = furthest.get(diagonal - 1) ?? 0
      const after = furthest.get(diagonal + 1) ?? 0
      let x = diagonal === -depth || (diagonal !== depth && before < after) ? after : before + 1
      let y = x - diagonal
      while (x < expectedLength && y < actualLength && expected[x] === actual[y]) {
        x += 1
        y += 1
      }
      furthest.set(diagonal, x)
      if (x >= expectedLength && y >= actualLength) {
        reached = true
        break
      }
    }
    if (reached) break
  }
  const edits: Edit[] = []
  let x = expectedLength
  let y = actualLength
  for (let depth = trace.length - 1; depth >= 0; depth--) {
    const snapshot = trace[depth]!
    const diagonal = x - y
    const before = snapshot.get(diagonal - 1) ?? -1
    const after = snapshot.get(diagonal + 1) ?? -1
    const previousDiagonal =
      diagonal === -depth || (diagonal !== depth && before < after) ? diagonal + 1 : diagonal - 1
    const previousX = snapshot.get(previousDiagonal) ?? 0
    const previousY = previousX - previousDiagonal
    while (x > previousX && y > previousY) {
      x -= 1
      y -= 1
      edits.push({ kind: "equal", text: expected[x]! })
    }
    if (depth === 0) break
    if (x === previousX) {
      y -= 1
      edits.push({ kind: "insert", text: actual[y]! })
    } else {
      x -= 1
      edits.push({ kind: "delete", text: expected[x]! })
    }
  }
  edits.reverse()
  return edits
}

function numberEdits(edits: Edit[]): NumberedEdit[] {
  let expectedLine = 1
  let actualLine = 1
  return edits.map((edit) => {
    const numbered = { ...edit, expectedLine, actualLine }
    if (edit.kind !== "insert") expectedLine += 1
    if (edit.kind !== "delete") actualLine += 1
    return numbered
  })
}

function hunkHeader(hunk: NumberedEdit[]): string {
  const expected = hunk.filter((edit) => edit.kind !== "insert")
  const actual = hunk.filter((edit) => edit.kind !== "delete")
  const expectedStart = expected[0]?.expectedLine ?? hunk[0]?.expectedLine ?? 1
  const actualStart = actual[0]?.actualLine ?? hunk[0]?.actualLine ?? 1
  return `@@ -${expectedStart},${expected.length} +${actualStart},${actual.length} @@`
}

function renderHunk(hunk: NumberedEdit[]): string[] {
  const lines: string[] = []
  let index = 0
  while (index < hunk.length) {
    if (hunk[index]!.kind === "equal") {
      lines.push(` ${hunk[index]!.text}`)
      index += 1
      continue
    }
    const group: NumberedEdit[] = []
    while (index < hunk.length && hunk[index]!.kind !== "equal") {
      group.push(hunk[index]!)
      index += 1
    }
    const reveal = group.some((edit) => needsReveal(edit.text))
    for (const edit of group) {
      const prefix = edit.kind === "delete" ? "-" : "+"
      lines.push(`${prefix}${reveal ? JSON.stringify(edit.text) : edit.text}`)
    }
  }
  return lines
}

function isChangedLine(line: string): boolean {
  return (
    (line.startsWith("+") && !line.startsWith("+++")) ||
    (line.startsWith("-") && !line.startsWith("---"))
  )
}

function needsReveal(text: string): boolean {
  return /[ \t]$/.test(text) || text.includes("\r")
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
// 手順が now を省いても壁時計を使わない。上書きは手順の now か environment.YARU_NOW
const DEFAULT_NOW = "2026-09-28T00:00:00.000Z"
// calendarDate と localDateTime は OS の時間帯を見る。既定を固定し、手順の TZ で上書きできる
const DEFAULT_TIME_ZONE = "Asia/Tokyo"
const MAIN_WORKTREE = "/Users/voq/ghq/github.com/aovoq/yaru"
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
  mkdirSync(join(parent, "home"))
  // git は実パスを返す。spawn に渡すパスと揃えないと、登録ファイルに同じ場所が 2 行出る
  const workspaceDirectory = realpathSync(join(parent, "workspace"))
  const stateDirectory = realpathSync(join(parent, "state"))
  const homeDirectory = realpathSync(join(parent, "home"))
  try {
    assertIsolated(workspaceDirectory)
    assertIsolated(stateDirectory)
    assertIsolated(homeDirectory)
    const worktrees = prepareWorkspace(workspaceDirectory, homeDirectory, scenario.setup)
    const bindings = bindingsFor(
      workspaceDirectory,
      stateDirectory,
      worktrees,
      homeDirectory,
      readCommits(workspaceDirectory, homeDirectory),
    )
    const steps: RecordedStep[] = []
    for (const step of scenario.steps) {
      const workingDirectory = resolveWorkingDirectory(
        scenario.name,
        workspaceDirectory,
        worktrees,
        step.workingDirectory,
      )
      const result = Bun.spawnSync([...cliCommand(repositoryRoot()), ...step.arguments], {
        cwd: workingDirectory,
        env: childEnvironment(stateDirectory, homeDirectory, step),
        stdin: Buffer.from(step.stdin ?? ""),
        stdout: "pipe",
        stderr: "pipe",
      })
      if (result.exitCode === null) {
        throw new Error("command did not exit: expected an exit code, actual none")
      }
      steps.push({
        arguments: step.arguments,
        ...recordedInputs(step),
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
  homeDirectory: string,
  commits: CommitBinding[],
): NormalizationBindings {
  return {
    workspaceDirectory,
    stateDirectory,
    worktrees,
    repositoryDirectory: realpathSync(repositoryRoot()),
    homeDirectory,
    commits,
  }
}

function prepareWorkspace(
  workspaceDirectory: string,
  homeDirectory: string,
  setup: ScenarioSetup | undefined,
): WorktreeBinding[] {
  const templateDirectory = join(dirname(workspaceDirectory), "git-template")
  mkdirSync(templateDirectory, { recursive: true })
  git(workspaceDirectory, homeDirectory, [
    "init",
    "--quiet",
    "--initial-branch",
    "main",
    "--template",
    templateDirectory,
  ])
  const gitUser = setup?.gitUser ?? DEFAULT_GIT_USER
  git(workspaceDirectory, homeDirectory, ["config", "user.name", gitUser.name])
  git(workspaceDirectory, homeDirectory, ["config", "user.email", gitUser.email])
  git(workspaceDirectory, homeDirectory, ["config", "core.abbrev", "7"])
  for (const file of setup?.files ?? []) {
    const destination = resolveInside(workspaceDirectory, file.path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, file.content)
  }
  const commits = setup?.commits ?? []
  for (const commit of commits) {
    const paths = commit.paths ?? ["."]
    for (const path of paths) resolveInside(workspaceDirectory, path === "." ? "." : path)
    git(workspaceDirectory, homeDirectory, ["add", "--", ...paths])
    git(
      workspaceDirectory,
      homeDirectory,
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
    git(workspaceDirectory, homeDirectory, [
      "worktree",
      "add",
      "--quiet",
      "-b",
      worktree.branch,
      directory,
    ])
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
  scenarioName: string,
  workspaceDirectory: string,
  worktrees: WorktreeBinding[],
  workingDirectory: string | undefined,
): string {
  let resolved = workspaceDirectory
  if (workingDirectory !== undefined && workingDirectory !== ".") {
    if (workingDirectory.startsWith("worktree:")) {
      const name = workingDirectory.slice("worktree:".length)
      const found = worktrees.find((worktree) => worktree.name === name)
      if (!found) {
        const names = worktrees.map((worktree) => worktree.name).join(", ") || "(none)"
        throw new Error(
          `unknown worktree: expected one of ${names}, actual ${JSON.stringify(name)}`,
        )
      }
      resolved = found.directory
    } else {
      resolved = resolveInside(workspaceDirectory, workingDirectory)
    }
  }
  if (!existsSync(resolved)) {
    throw new Error(
      `${scenarioName}: workingDirectory not found: expected ${resolved}, actual missing`,
    )
  }
  return resolved
}

function recordedInputs(step: ScenarioStep): {
  stdin: string
  environment: Record<string, string>
  now: string
  workingDirectory: string
} {
  const environment: Record<string, string> = {
    TZ: step.environment?.TZ ?? DEFAULT_TIME_ZONE,
  }
  for (const [key, value] of Object.entries(step.environment ?? {})) {
    if (
      key === "TZ" ||
      key === "YARU_NOW" ||
      key === "YARU_STATE_DIR" ||
      key === "HOME" ||
      key === "GIT_CONFIG_GLOBAL" ||
      key === "GIT_CONFIG_NOSYSTEM"
    ) {
      continue
    }
    environment[key] = value
  }
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(environment).sort()) sorted[key] = environment[key]!
  return {
    stdin: step.stdin ?? "",
    environment: sorted,
    now: step.now ?? step.environment?.YARU_NOW ?? DEFAULT_NOW,
    workingDirectory: step.workingDirectory ?? ".",
  }
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
function childEnvironment(
  stateDirectory: string,
  homeDirectory: string,
  step: ScenarioStep,
): Record<string, string> {
  if (
    step.environment &&
    Object.prototype.hasOwnProperty.call(step.environment, "YARU_STATE_DIR")
  ) {
    throw new Error(
      "invalid environment: expected no YARU_STATE_DIR, actual the step sets YARU_STATE_DIR",
    )
  }
  const environment = isolatedEnvironment(homeDirectory)
  environment.TZ = DEFAULT_TIME_ZONE
  environment.YARU_NOW = DEFAULT_NOW
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
  environment.HOME = homeDirectory
  environment.GIT_CONFIG_GLOBAL = "/dev/null"
  environment.GIT_CONFIG_NOSYSTEM = "1"
  return environment
}

function isolatedEnvironment(homeDirectory: string): Record<string, string> {
  return {
    ...baseEnvironment(),
    HOME: homeDirectory,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    TZ: DEFAULT_TIME_ZONE,
  }
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
  homeDirectory: string,
  args: string[],
  extraEnvironment: Record<string, string> = {},
): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: workingDirectory,
    env: { ...isolatedEnvironment(homeDirectory), ...extraEnvironment },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: expected exit code 0, actual ${result.exitCode ?? "signal"} ${result.stderr.toString().trim()}`,
    )
  }
}

function readCommits(workspaceDirectory: string, homeDirectory: string): CommitBinding[] {
  const result = Bun.spawnSync(["git", "log", "--all", "--reverse", "--format=%H%x09%h"], {
    cwd: workspaceDirectory,
    env: isolatedEnvironment(homeDirectory),
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) return []
  const commits: CommitBinding[] = []
  for (const line of result.stdout.toString().split("\n")) {
    if (line === "") continue
    const [full, short] = line.split("\t")
    if (full === undefined || short === undefined) continue
    commits.push({ full, short })
  }
  return commits
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
        const children = readdirSync(absolute)
        if (children.length === 0) {
          files.push({
            path: relative(root, absolute).split(sep).join("/"),
            content: "",
            directory: true,
          })
        } else {
          visit(absolute)
        }
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

export function assertIsolated(directory: string): void {
  const resolved = realpathSync(directory)
  const repository = realpathSync(repositoryRoot())
  if (isInside(repository, resolved)) {
    throw new Error(
      `refusing to touch the repository: expected a temp directory, actual ${resolved}`,
    )
  }
  if (existsSync(MAIN_WORKTREE)) {
    const resolvedMain = realpathSync(MAIN_WORKTREE)
    if (isInside(resolvedMain, resolved)) {
      throw new Error(
        `refusing to touch the main worktree: expected a temp directory, actual ${resolved}`,
      )
    }
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
    scenarios.push(parseScenario(name, JSON.parse(readFileSync(join(directory, name), "utf8"))))
  }
  return scenarios
}

const SCENARIO_KEYS = ["name", "description", "setup", "steps"]
const SETUP_KEYS = ["files", "commits", "worktrees", "gitUser"]
const FILE_KEYS = ["path", "content"]
const COMMIT_KEYS = ["message", "paths"]
const WORKTREE_KEYS = ["name", "branch"]
const GIT_USER_KEYS = ["name", "email"]
const STEP_KEYS = ["arguments", "stdin", "environment", "now", "workingDirectory"]

function parseScenario(fileName: string, value: unknown): ScenarioFile {
  const fallback = fileName.slice(0, -".json".length)
  if (!isRecord(value)) {
    throw new Error(
      `${fallback}: invalid scenario: expected an object, actual ${JSON.stringify(value)}`,
    )
  }
  const scenarioName = typeof value.name === "string" ? value.name : fallback
  assertKeys(scenarioName, "", value, SCENARIO_KEYS)
  if (value.name !== fallback) {
    throw new Error(
      `invalid scenario name: expected ${fallback}, actual ${JSON.stringify(value.name)}`,
    )
  }
  if (!SCENARIO_NAME.test(scenarioName)) {
    throw new Error(
      `invalid scenario name: expected lowercase words separated by hyphens, actual ${JSON.stringify(scenarioName)}`,
    )
  }
  if (typeof value.description !== "string" || value.description.trim() === "") {
    throw new Error(
      `${scenarioName}: invalid scenario description: expected a non-empty string, actual ${JSON.stringify(value.description)}`,
    )
  }
  return {
    name: scenarioName,
    description: value.description,
    setup: value.setup === undefined ? undefined : parseSetup(scenarioName, value.setup),
    steps: parseSteps(scenarioName, value.steps),
  }
}

function parseSetup(scenarioName: string, value: unknown): ScenarioSetup {
  if (!isRecord(value)) {
    throw new Error(
      `${scenarioName}: invalid setup: expected an object, actual ${JSON.stringify(value)}`,
    )
  }
  assertKeys(scenarioName, "setup", value, SETUP_KEYS)
  const setup: ScenarioSetup = {}
  if (value.files !== undefined) setup.files = parseFiles(scenarioName, value.files)
  if (value.commits !== undefined) setup.commits = parseCommits(scenarioName, value.commits)
  if (value.worktrees !== undefined) setup.worktrees = parseWorktrees(scenarioName, value.worktrees)
  if (value.gitUser !== undefined) setup.gitUser = parseGitUser(scenarioName, value.gitUser)
  return setup
}

function parseFiles(scenarioName: string, value: unknown): { path: string; content: string }[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `${scenarioName}: invalid setup files: expected an array, actual ${JSON.stringify(value)}`,
    )
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error(
        `${scenarioName}: invalid setup file: expected an object, actual ${JSON.stringify(item)}`,
      )
    }
    assertKeys(scenarioName, "file", item, FILE_KEYS)
    if (typeof item.path !== "string" || typeof item.content !== "string") {
      throw new Error(
        `${scenarioName}: invalid setup file: expected path and content strings, actual ${JSON.stringify(item)}`,
      )
    }
    return { path: item.path, content: item.content }
  })
}

function parseCommits(
  scenarioName: string,
  value: unknown,
): { message: string; paths?: string[] }[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `${scenarioName}: invalid setup commits: expected an array, actual ${JSON.stringify(value)}`,
    )
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error(
        `${scenarioName}: invalid commit: expected an object, actual ${JSON.stringify(item)}`,
      )
    }
    assertKeys(scenarioName, "commit", item, COMMIT_KEYS)
    if (typeof item.message !== "string") {
      throw new Error(
        `${scenarioName}: invalid commit message: expected a string, actual ${JSON.stringify(item.message)}`,
      )
    }
    if (item.paths !== undefined && !isStringArray(item.paths)) {
      throw new Error(
        `${scenarioName}: invalid commit paths: expected an array of strings, actual ${JSON.stringify(item.paths)}`,
      )
    }
    return item.paths === undefined
      ? { message: item.message }
      : { message: item.message, paths: item.paths }
  })
}

function parseWorktrees(scenarioName: string, value: unknown): { name: string; branch: string }[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `${scenarioName}: invalid setup worktrees: expected an array, actual ${JSON.stringify(value)}`,
    )
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error(
        `${scenarioName}: invalid worktree: expected an object, actual ${JSON.stringify(item)}`,
      )
    }
    assertKeys(scenarioName, "worktree", item, WORKTREE_KEYS)
    if (typeof item.name !== "string" || typeof item.branch !== "string") {
      throw new Error(
        `${scenarioName}: invalid worktree: expected name and branch strings, actual ${JSON.stringify(item)}`,
      )
    }
    return { name: item.name, branch: item.branch }
  })
}

function parseGitUser(scenarioName: string, value: unknown): { name: string; email: string } {
  if (!isRecord(value)) {
    throw new Error(
      `${scenarioName}: invalid gitUser: expected an object, actual ${JSON.stringify(value)}`,
    )
  }
  assertKeys(scenarioName, "gitUser", value, GIT_USER_KEYS)
  if (typeof value.name !== "string" || typeof value.email !== "string") {
    throw new Error(
      `${scenarioName}: invalid gitUser: expected name and email strings, actual ${JSON.stringify(value)}`,
    )
  }
  return { name: value.name, email: value.email }
}

function parseSteps(scenarioName: string, value: unknown): ScenarioStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `${scenarioName}: invalid scenario steps: expected a non-empty array, actual ${JSON.stringify(value)}`,
    )
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error(
        `${scenarioName}: invalid step: expected an object, actual ${JSON.stringify(item)}`,
      )
    }
    assertKeys(scenarioName, "step", item, STEP_KEYS)
    if (!isStringArray(item.arguments)) {
      throw new Error(
        `${scenarioName}: invalid step arguments: expected an array of strings, actual ${JSON.stringify(item.arguments)}`,
      )
    }
    if (item.stdin !== undefined && typeof item.stdin !== "string") {
      throw new Error(
        `${scenarioName}: invalid stdin: expected a string, actual ${JSON.stringify(item.stdin)}`,
      )
    }
    if (item.now !== undefined && typeof item.now !== "string") {
      throw new Error(
        `${scenarioName}: invalid now: expected a string, actual ${JSON.stringify(item.now)}`,
      )
    }
    if (item.workingDirectory !== undefined && typeof item.workingDirectory !== "string") {
      throw new Error(
        `${scenarioName}: invalid workingDirectory: expected a string, actual ${JSON.stringify(item.workingDirectory)}`,
      )
    }
    const step: ScenarioStep = { arguments: item.arguments }
    if (typeof item.stdin === "string") step.stdin = item.stdin
    if (item.environment !== undefined)
      step.environment = parseEnvironment(scenarioName, item.environment)
    if (typeof item.now === "string") step.now = item.now
    if (typeof item.workingDirectory === "string") step.workingDirectory = item.workingDirectory
    return step
  })
}

function parseEnvironment(scenarioName: string, value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(
      `${scenarioName}: invalid environment: expected an object, actual ${JSON.stringify(value)}`,
    )
  }
  const environment: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(
        `${scenarioName}: invalid environment ${key}: expected a string, actual ${JSON.stringify(item)}`,
      )
    }
    environment[key] = item
  }
  return environment
}

function assertKeys(
  scenarioName: string,
  label: string,
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    const name = label === "" ? "unknown key" : `unknown ${label} key`
    throw new Error(
      `${scenarioName}: ${name}: expected one of ${allowed.join(", ")}, actual ${key}`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
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
