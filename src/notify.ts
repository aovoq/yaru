import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Question } from "./questions"
import type { Store } from "./store"

// 質問が出たことを人に知らせる
// Slack や ntfy など届け先は人ごとに違うので、yaru は届け先を知らず、config.yml の notify に書いたコマンドを呼ぶだけにする
// コマンドは sh -c で動き、stdin に {event, question} の JSON を受け取る

const NOTIFY_TIMEOUT_MILLISECONDS = 10_000

export type NotifyEvent = { event: "question.created"; question: Question }

export function readConfig(store: Store): { notify: string | null } {
  let text = ""
  try {
    text = readFileSync(join(store.dir, "config.yml"), "utf8")
  } catch {
    return { notify: null }
  }
  // config.yml は key: value の 1 行ずつだけを読む。YAML の他の書き方は使わない
  for (const line of text.split("\n")) {
    const match = line.match(/^notify:\s*(.*)$/)
    if (match && match[1]!.trim()) return { notify: match[1]!.trim() }
  }
  return { notify: null }
}

// 通知に失敗しても質問は保存済みなので、呼び出し側は失敗を警告として出すだけにする
export function notify(store: Store, payload: NotifyEvent): string | null {
  const command = readConfig(store).notify
  if (!command) return null
  const result = Bun.spawnSync(["sh", "-c", command], {
    cwd: store.root,
    stdin: Buffer.from(JSON.stringify(payload)),
    stdout: "ignore",
    stderr: "pipe",
    timeout: NOTIFY_TIMEOUT_MILLISECONDS,
    env: {
      ...process.env,
      YARU_EVENT: payload.event,
      YARU_QUESTION_ID: payload.question.id,
      YARU_QUESTION_TITLE: payload.question.title,
    },
  })
  if (result.exitCode === 0) return null
  const detail = result.stderr.toString().trim()
  if (result.exitCode === null) {
    return `notify command failed: expected to finish within ${NOTIFY_TIMEOUT_MILLISECONDS}ms, actual timed out`
  }
  return `notify command failed: expected exit code 0, actual ${result.exitCode}${detail ? `: ${detail}` : ""}`
}
