// 質問や issue を「どのエージェントが、どの作業場所で」作ったかを残すため、書き込んだ時点の出どころを読む
// 並列の worktree で動くエージェントの質問が混ざると、人がどれに答えているのか分からなくなるため
// セッションは Claude Code と Codex が子プロセスへ渡す環境変数から、作業場所は git から読む
// https://git-scm.com/docs/git-rev-parse#Documentation/git-rev-parse.txt---show-toplevel

export type Provenance = {
  // エージェントのセッション ID。人が手で CLI を叩いたときは null
  session: string | null
  // 書き込んだ場所の git の作業ツリーの最上位 (linked worktree ならその場所)。git の外なら null
  worktree: string | null
  // その作業ツリーで切り替えているブランチ。detached HEAD や git の外なら null
  branch: string | null
}

// 先に並べたものを優先する。Claude Code を Codex の中から呼ぶことは無いので、順番は見つかりやすさで決めている
const SESSION_ENVIRONMENT_VARIABLES = ["CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID"] as const

export function readProvenance(
  cwd: string,
  environment: Record<string, string | undefined> = process.env,
): Provenance {
  return {
    session: readSession(environment),
    worktree: git(cwd, ["rev-parse", "--show-toplevel"]),
    branch: git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
  }
}

function readSession(environment: Record<string, string | undefined>): string | null {
  for (const name of SESSION_ENVIRONMENT_VARIABLES) {
    const value = environment[name]?.trim()
    if (value) return value
  }
  return null
}

function git(cwd: string, args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" })
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim() || null
}
