// dashboard に「成果物の最新」を出すため、ワークスペースの git の状態を読む
// エージェントはコミットまでして push を人に任せることが多いので、まだ送っていないコミットを目立たせる

export type RepositoryCommit = {
  hash: string
  subject: string
  author: string
  committedAt: string
  // upstream が無いときは分からないので null
  pushed: boolean | null
}

export type RepositoryState = {
  branch: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  uncommittedFiles: number
  commits: RepositoryCommit[]
}

export const RECENT_COMMITS_LIMIT = 10

const FIELD_SEPARATOR = "\u001f"

export function readRepositoryState(root: string): RepositoryState | null {
  if (git(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") return null
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])
  const upstream = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
  let ahead: number | null = null
  let behind: number | null = null
  let unpushed = new Set<string>()
  if (upstream) {
    const counts = git(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])
    const [behindCount, aheadCount] = (counts ?? "").split(/\s+/).map(Number)
    behind = Number.isInteger(behindCount) ? behindCount! : null
    ahead = Number.isInteger(aheadCount) ? aheadCount! : null
    unpushed = new Set(
      (git(root, ["rev-list", "@{upstream}..HEAD"]) ?? "").split("\n").filter(Boolean),
    )
  }
  const status = git(root, ["status", "--porcelain"]) ?? ""
  const log =
    git(root, [
      "log",
      `-${RECENT_COMMITS_LIMIT}`,
      `--format=%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%cI`,
    ]) ?? ""
  const commits = log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [fullHash, hash, subject, author, committedAt] = line.split(FIELD_SEPARATOR)
      return {
        hash: hash!,
        subject: subject!,
        author: author!,
        committedAt: committedAt!,
        pushed: upstream ? !unpushed.has(fullHash!) : null,
      }
    })
  return {
    branch,
    upstream,
    ahead,
    behind,
    uncommittedFiles: status.split("\n").filter(Boolean).length,
    commits,
  }
}

export type IssueCommit = {
  hash: string
  subject: string
  author: string
  committedAt: string
}

export const ISSUE_COMMITS_LIMIT = 20

// issue に関わるコミットを集める。issue の画面から「実際に何が変わったか」へ辿れるようにするため
// 1 つはコミットメッセージで #<id> に触れたもの。どのブランチにあっても拾うので --all で探す
// もう 1 つは、issue を最後に保存したエージェントのブランチにあって、元のフォルダの HEAD にまだ無いもの (マージ前の作業)
// https://git-scm.com/docs/git-log#Documentation/git-log.txt---grepltpatterngt
export function commitsForIssue(root: string, id: string, branch: string | null): IssueCommit[] {
  if (!/^\d+$/.test(id)) {
    throw new Error(`invalid issue id: expected digits, actual ${JSON.stringify(id)}`)
  }
  if (git(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") return []
  const format = `--format=%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%cI`
  const limit = `-${ISSUE_COMMITS_LIMIT}`
  // \b は git の正規表現で使えるかが環境によって違うので、#1 が #12 に当たらないよう数字以外か行末で区切る
  const mentioned = git(root, [
    "log",
    "--all",
    limit,
    "--extended-regexp",
    `--grep=#${id}([^0-9]|$)`,
    format,
  ])
  // ブランチ名は frontmatter の手で書ける値なので、そのまま git log に渡すと - で始まる名前は option に、a..b は範囲に読まれる
  // refs/heads/ の下の 1 つのコミットに解決できたときだけ、そのハッシュで辿る。消えたブランチでは #<id> のコミットだけを返す
  // https://git-scm.com/docs/git-rev-parse#Documentation/git-rev-parse.txt---verify
  const branchCommit = branch
    ? git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`])
    : null
  const onBranch = branchCommit
    ? git(root, ["log", limit, format, branchCommit, "--not", "HEAD", "--"])
    : null
  const byHash = new Map<string, IssueCommit & { order: number }>()
  const lines = [...(onBranch ?? "").split("\n"), ...(mentioned ?? "").split("\n")]
  for (const [order, line] of lines.entries()) {
    if (!line) continue
    const [fullHash, hash, subject, author, committedAt] = line.split(FIELD_SEPARATOR)
    if (byHash.has(fullHash!)) continue
    byHash.set(fullHash!, {
      hash: hash!,
      subject: subject!,
      author: author!,
      committedAt: committedAt!,
      order,
    })
  }
  return [...byHash.values()]
    .sort(
      (left, right) =>
        Date.parse(right.committedAt) - Date.parse(left.committedAt) || left.order - right.order,
    )
    .slice(0, ISSUE_COMMITS_LIMIT)
    .map(({ order: _order, ...commit }) => commit)
}

function git(root: string, args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "ignore" })
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
}
