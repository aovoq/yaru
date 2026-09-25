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

function git(root: string, args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "ignore" })
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
}
