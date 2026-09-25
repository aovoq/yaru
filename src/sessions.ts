import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

// Claude Code のセッションログ (~/.claude/projects/<作業ディレクトリ>/<session>.jsonl) から、
// エージェントの健康状態 (費用・キャッシュ・ツールのエラー・割り込み) を読む
// 本文は読み出さず、数だけを数える

export type SessionSummary = {
  id: string
  // linked worktree で動いたセッションはそのブランチ名 (detached ならフォルダ名)。元のフォルダなら null
  worktree: string | null
  title: string | null
  startedAt: string | null
  lastActivityAt: string | null
  models: string[]
  assistantMessages: number
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  costUsd: number
  unpricedMessages: number
  toolUses: number
  toolResults: number
  toolErrors: number
  interruptions: number
  subagents: number
}

export type SessionTotals = {
  sessions: number
  costUsd: number
  unpricedMessages: number
  assistantMessages: number
  cacheReadRatio: number | null
  toolResults: number
  toolErrors: number
  toolErrorRatio: number | null
  interruptions: number
}

export type SessionHealth = {
  directory: string | null
  windowDays: number
  sessions: SessionSummary[]
  totals: SessionTotals
}

export const SESSION_WINDOW_DAYS = 7

type ModelPrice = { input: number; output: number; cacheRead: number }

// API 換算の単価 (USD / 100 万トークン)。サブスクリプションで使っていても、使った量の目安として API の単価で数える
// cache write は input の 1.25 倍 (5 分) と 2 倍 (1 時間)、fast mode は 2 倍
// https://platform.claude.com/docs/en/about-claude/pricing
const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
}

const CACHE_WRITE_5M_MULTIPLIER = 1.25
const CACHE_WRITE_1H_MULTIPLIER = 2
const FAST_MODE_MULTIPLIER = 2
const MILLION = 1_000_000

// Claude Code が API を呼ばずに差し込む応答で、usage は常に 0 なので数えない
const SYNTHETIC_MODEL = "<synthetic>"

const INTERRUPTION_PREFIX = "[Request interrupted by user"

type FileStats = Omit<SessionSummary, "id" | "worktree" | "subagents" | "models"> & {
  models: Set<string>
}

const fileCache = new Map<string, { modifiedMs: number; size: number; stats: FileStats }>()

// Claude Code は作業ディレクトリの絶対パスの / と . を - に置き換えたディレクトリにログを置く
export function claudeProjectDirectory(root: string, home = homedir()): string {
  return join(home, ".claude", "projects", root.replace(/[/.]/g, "-"))
}

export function readSessionHealth(
  root: string,
  options: { home?: string; now?: Date; windowDays?: number } = {},
): SessionHealth {
  const now = options.now ?? new Date()
  const windowDays = options.windowDays ?? SESSION_WINDOW_DAYS
  const since = now.getTime() - windowDays * 86_400_000
  const directory = claudeProjectDirectory(root, options.home)
  // 並列の worktree で動くエージェントのログは worktree ごとの別ディレクトリに書かれるので、今ある worktree の分も読む
  // 消した worktree はどこにあったか分からなくなるため数えない
  const sources = [
    { directory, worktree: null as string | null },
    ...linkedWorktrees(root).map((entry) => ({
      directory: claudeProjectDirectory(entry.path, options.home),
      worktree: entry.label,
    })),
  ]
  const sessions: SessionSummary[] = []
  for (const source of sources) {
    if (!existsSync(source.directory)) continue
    for (const name of readdirSync(source.directory)) {
      if (!name.endsWith(".jsonl")) continue
      const path = join(source.directory, name)
      const stat = statSync(path)
      if (stat.mtimeMs < since) continue
      sessions.push(readSession(source.directory, name.slice(0, -".jsonl".length), source.worktree))
    }
  }
  sessions.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
  return {
    directory: existsSync(directory) || sessions.length > 0 ? directory : null,
    windowDays,
    sessions,
    totals: summarize(sessions),
  }
}

// issue や質問に残したセッション ID から、そのセッションの題名や最後に動いた時刻を引く
// 見るのは元のフォルダ・今ある linked worktree・記録した作業ツリーのログで、期間では絞らない (古い issue のセッションも引けるように)
// 記録した作業ツリーは消したあとでもログのディレクトリが残るので、そこも探す
// Codex のセッションはここのログに無いので null になる
export function findSession(
  root: string,
  id: string,
  options: { home?: string; worktree?: string | null } = {},
): SessionSummary | null {
  // ID はファイル名に使うので、パスを辿れる文字を含むものは探さない
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
  const linked = linkedWorktrees(root)
  const sources = [
    { directory: claudeProjectDirectory(root, options.home), worktree: null as string | null },
    ...linked.map((entry) => ({
      directory: claudeProjectDirectory(entry.path, options.home),
      worktree: entry.label,
    })),
  ]
  if (options.worktree && options.worktree !== root) {
    const known = linked.find((entry) => entry.path === options.worktree)
    sources.push({
      directory: claudeProjectDirectory(options.worktree, options.home),
      worktree: known ? known.label : basename(options.worktree),
    })
  }
  for (const source of sources) {
    if (existsSync(join(source.directory, `${id}.jsonl`))) {
      return readSession(source.directory, id, source.worktree)
    }
  }
  return null
}

// セッションの本体のログと、そのセッションが起こしたサブエージェントのログを合わせて 1 つにまとめる
function readSession(directory: string, id: string, worktree: string | null): SessionSummary {
  const path = join(directory, `${id}.jsonl`)
  const stat = statSync(path)
  const subagentFiles = listJsonl(join(directory, id, "subagents"))
  return combine(
    id,
    worktree,
    readFileStats(path, stat.mtimeMs, stat.size),
    subagentFiles.map((file) => {
      const subagentStat = statSync(file)
      return readFileStats(file, subagentStat.mtimeMs, subagentStat.size)
    }),
  )
}

// git worktree list の先頭は元のフォルダなので、2 つ目以降の linked worktree だけを返す
// https://git-scm.com/docs/git-worktree#_porcelain_format
function linkedWorktrees(root: string): { path: string; label: string }[] {
  if (!existsSync(root)) return []
  const result = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], {
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
  })
  if (result.exitCode !== 0) return []
  const entries = result.stdout
    .toString()
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n")
      const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length)
      const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length)
      return path
        ? { path, label: branch ? branch.replace(/^refs\/heads\//, "") : basename(path) }
        : null
    })
    .filter((entry): entry is { path: string; label: string } => entry !== null)
  return entries.slice(1)
}

function listJsonl(directory: string): string[] {
  if (!existsSync(directory)) return []
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listJsonl(path))
    else if (entry.name.endsWith(".jsonl")) files.push(path)
  }
  return files
}

// ログは数百 MB になるので、変わっていないファイルは読み直さない
function readFileStats(path: string, modifiedMs: number, size: number): FileStats {
  const cached = fileCache.get(path)
  if (cached && cached.modifiedMs === modifiedMs && cached.size === size) return cached.stats
  const stats = parseFile(readFileSync(path, "utf8"))
  fileCache.set(path, { modifiedMs, size, stats })
  return stats
}

function parseFile(text: string): FileStats {
  const stats: FileStats = {
    title: null,
    startedAt: null,
    lastActivityAt: null,
    models: new Set(),
    assistantMessages: 0,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    unpricedMessages: 0,
    toolUses: 0,
    toolResults: 0,
    toolErrors: 0,
    interruptions: 0,
  }
  const seenMessages = new Set<string>()
  for (const line of text.split("\n")) {
    if (!line) continue
    let entry: LogEntry
    try {
      entry = JSON.parse(line)
    } catch {
      // 書き込み途中の行や壊れた行があっても、残りの行は数える
      continue
    }
    if (entry.type === "ai-title" && typeof entry.aiTitle === "string") stats.title = entry.aiTitle
    if (typeof entry.timestamp === "string") {
      stats.startedAt ??= entry.timestamp
      if (!stats.lastActivityAt || entry.timestamp > stats.lastActivityAt) {
        stats.lastActivityAt = entry.timestamp
      }
    }
    const content = Array.isArray(entry.message?.content) ? entry.message.content : []
    if (entry.type === "assistant") countAssistant(stats, entry, content, seenMessages)
    if (entry.type === "user") countUser(stats, content)
  }
  return stats
}

type LogEntry = {
  type?: string
  timestamp?: string
  aiTitle?: string
  message?: {
    id?: string
    model?: string
    content?: unknown
    usage?: Usage
  }
}

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  speed?: string
}

type ContentBlock = { type?: string; is_error?: boolean; text?: string }

// Claude Code は 1 つの応答を content block ごとに別の行へ書き、どの行にも同じ usage を載せるので、
// usage は message id ごとに 1 回だけ数える。tool_use は block ごとなので行ごとに数える
function countAssistant(
  stats: FileStats,
  entry: LogEntry,
  content: ContentBlock[],
  seenMessages: Set<string>,
): void {
  for (const block of content) if (block.type === "tool_use") stats.toolUses++
  const message = entry.message
  if (!message?.usage || message.model === SYNTHETIC_MODEL) return
  if (message.id) {
    if (seenMessages.has(message.id)) return
    seenMessages.add(message.id)
  }
  const usage = message.usage
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheCreation = usage.cache_creation_input_tokens ?? 0
  stats.assistantMessages++
  stats.inputTokens += input
  stats.outputTokens += output
  stats.cacheReadTokens += cacheRead
  stats.cacheCreationTokens += cacheCreation
  if (message.model) stats.models.add(message.model)
  const price = message.model ? priceOf(message.model) : undefined
  if (!price) {
    stats.unpricedMessages++
    return
  }
  const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const cacheWrite5m =
    usage.cache_creation?.ephemeral_5m_input_tokens ?? cacheCreation - cacheWrite1h
  const cost =
    (input * price.input +
      output * price.output +
      cacheRead * price.cacheRead +
      cacheWrite5m * price.input * CACHE_WRITE_5M_MULTIPLIER +
      cacheWrite1h * price.input * CACHE_WRITE_1H_MULTIPLIER) /
    MILLION
  stats.costUsd += usage.speed === "fast" ? cost * FAST_MODE_MULTIPLIER : cost
}

// claude-haiku-4-5-20251001 のような日付つきの snapshot id は、日付を外した model の単価で数える
function priceOf(model: string): ModelPrice | undefined {
  return MODEL_PRICES[model] ?? MODEL_PRICES[model.replace(/-\d{8}$/, "")]
}

function countUser(stats: FileStats, content: ContentBlock[]): void {
  for (const block of content) {
    if (block.type === "tool_result") {
      stats.toolResults++
      if (block.is_error === true) stats.toolErrors++
    }
    if (block.type === "text" && block.text?.startsWith(INTERRUPTION_PREFIX)) stats.interruptions++
  }
}

function combine(
  id: string,
  worktree: string | null,
  main: FileStats,
  subagents: FileStats[],
): SessionSummary {
  const all = [main, ...subagents]
  const models = new Set<string>()
  for (const stats of all) for (const model of stats.models) models.add(model)
  const timestamps = all.flatMap((stats) => [stats.startedAt, stats.lastActivityAt])
  const present = timestamps.filter((value): value is string => value !== null).sort()
  const sum = (key: keyof FileStats) =>
    all.reduce((total, stats) => total + (stats[key] as number), 0)
  return {
    id,
    worktree,
    title: main.title,
    startedAt: present[0] ?? null,
    lastActivityAt: present[present.length - 1] ?? null,
    models: [...models].sort(),
    assistantMessages: sum("assistantMessages"),
    inputTokens: sum("inputTokens"),
    cacheCreationTokens: sum("cacheCreationTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    outputTokens: sum("outputTokens"),
    costUsd: sum("costUsd"),
    unpricedMessages: sum("unpricedMessages"),
    toolUses: sum("toolUses"),
    toolResults: sum("toolResults"),
    toolErrors: sum("toolErrors"),
    // 割り込みは人がメインのセッションに対して行うものなので、サブエージェントの分は数えない
    interruptions: main.interruptions,
    subagents: subagents.length,
  }
}

function summarize(sessions: SessionSummary[]): SessionTotals {
  const sum = (key: keyof SessionSummary) =>
    sessions.reduce((total, session) => total + (session[key] as number), 0)
  const cacheRead = sum("cacheReadTokens")
  const promptTokens = sum("inputTokens") + sum("cacheCreationTokens") + cacheRead
  const toolResults = sum("toolResults")
  const toolErrors = sum("toolErrors")
  return {
    sessions: sessions.length,
    costUsd: sum("costUsd"),
    unpricedMessages: sum("unpricedMessages"),
    assistantMessages: sum("assistantMessages"),
    cacheReadRatio: promptTokens > 0 ? cacheRead / promptTokens : null,
    toolResults,
    toolErrors,
    toolErrorRatio: toolResults > 0 ? toolErrors / toolResults : null,
    interruptions: sum("interruptions"),
  }
}
