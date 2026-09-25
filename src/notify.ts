import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readConfigValue } from "./config"
import {
  listQuestions,
  markExpiringNotified,
  questionsAboutToExpire,
  type Question,
} from "./questions"
import { listIssues, open, type Issue, type Store } from "./store"
import { listWorkspaces } from "./workspaces"

// 質問が出たこと、質問の期限が近いこと、issue が進行中のまま止まっていることを人に知らせる
// Slack や ntfy など届け先は人ごとに違うので、yaru は届け先を知らず、config.yml の notify に書いたコマンドを呼ぶだけにする
// コマンドは sh -c で動き、stdin に {event, url, question} か {event, url, issue} の JSON を受け取る
// url は知らせから直接その質問へ飛べるようにするためのもの

const NOTIFY_TIMEOUT_MILLISECONDS = 10_000

export type NotifyEvent =
  | { event: "question.created"; url: string; question: Question }
  | { event: "question.expiring"; url: string; question: Question }
  | { event: "issue.stale"; url: string; issue: Issue }

export type Config = {
  notify: string | null
  // スマホから Tailscale などで開くときの URL の頭 (例: https://mac.example.ts.net)。無ければ 127.0.0.1 を使う
  publicUrl: string | null
}

export function readConfig(store: Store): Config {
  return {
    notify: readConfigValue(store, "notify"),
    publicUrl: readConfigValue(store, "publicUrl")?.replace(/\/+$/, "") || null,
  }
}

// dashboard の質問カードには id="q-<id>" が付いているので、fragment でそのカードまで送る
// https://www.rfc-editor.org/rfc/rfc3986#section-3.5
export function questionUrl(baseUrl: string, slug: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}/dashboard#q-${encodeURIComponent(id)}`
}

// 板は ?id=<id> でその issue を開く
export function issueUrl(baseUrl: string, slug: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}/?id=${encodeURIComponent(id)}`
}

// 知らせのリンクの頭。config.yml の publicUrl を優先する
export function notifyBaseUrl(store: Store, fallback: string): string {
  return readConfig(store).publicUrl ?? fallback
}

// 通知に失敗しても質問は保存済みなので、呼び出し側は失敗を警告として出すだけにする
// CLI は 1 回動いて終わるので、終わる前に確実に送れるよう同期で待つ
export function notify(store: Store, payload: NotifyEvent): string | null {
  const command = readConfig(store).notify
  if (!command) return null
  const result = Bun.spawnSync(["sh", "-c", command], {
    cwd: store.root,
    stdin: Buffer.from(JSON.stringify(payload)),
    stdout: "ignore",
    stderr: "pipe",
    timeout: NOTIFY_TIMEOUT_MILLISECONDS,
    env: notifyEnvironment(payload),
  })
  return failureMessage(result.exitCode, result.stderr.toString())
}

// serve の中から呼ぶ版。同期で待つと、コマンドが終わるまで全ての画面の応答が止まるため
export async function notifyAsync(store: Store, payload: NotifyEvent): Promise<string | null> {
  const command = readConfig(store).notify
  if (!command) return null
  const child = Bun.spawn(["sh", "-c", command], {
    cwd: store.root,
    stdin: Buffer.from(JSON.stringify(payload)),
    stdout: "ignore",
    stderr: "pipe",
    timeout: NOTIFY_TIMEOUT_MILLISECONDS,
    env: notifyEnvironment(payload),
  })
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  return failureMessage(child.signalCode ? null : exitCode, stderr)
}

// serve が毎分呼ぶ。期限が近い質問を、登録された全ワークスペースから探して 1 度だけ知らせる
// 送る前に知らせた印を付ける。コマンドが遅い間に次の見回りが来ても、同じ質問を二重に送らないため
export async function notifyExpiringQuestions(
  directory: string,
  now: Date,
  fallbackBaseUrl: string,
): Promise<string[]> {
  const warnings: string[] = []
  for (const workspace of listWorkspaces(directory)) {
    const store = open(workspace.root)
    if (!readConfig(store).notify) continue
    const baseUrl = notifyBaseUrl(store, fallbackBaseUrl)
    for (const question of questionsAboutToExpire(listQuestions(store, {}, now), now)) {
      const marked = markExpiringNotified(store, question.id, now)
      const warning = await notifyAsync(store, {
        event: "question.expiring",
        url: questionUrl(baseUrl, workspace.slug, question.id),
        question: marked,
      })
      if (warning) warnings.push(`${workspace.slug} question ${question.id}: ${warning}`)
    }
  }
  return warnings
}

// serve が毎分呼ぶ。進行中のまま staleAfter を過ぎた issue を知らせる
// issue のファイルは git で管理していて、書くと updatedAt も変わって止まっていないことになるので、知らせた印は状態のフォルダに置く
// 同じ issue は、更新されて (updatedAt が変わって) また止まるまで知らせ直さない
export async function notifyStaleIssues(
  directory: string,
  now: Date,
  fallbackBaseUrl: string,
): Promise<string[]> {
  const warnings: string[] = []
  const notified = readNotifiedStaleIssues(directory)
  const stillStale: Record<string, string> = {}
  for (const workspace of listWorkspaces(directory)) {
    const store = open(workspace.root)
    if (!readConfig(store).notify) continue
    const baseUrl = notifyBaseUrl(store, fallbackBaseUrl)
    const stale = listIssues(store, { status: "in_progress" }, now).filter((issue) => issue.stale)
    for (const issue of stale) {
      const key = `${workspace.root}#${issue.id}`
      stillStale[key] = issue.updatedAt
      if (notified[key] === issue.updatedAt) continue
      // 送る前に印を付ける理由は notifyExpiringQuestions と同じ
      writeNotifiedStaleIssues(directory, { ...notified, ...stillStale })
      const warning = await notifyAsync(store, {
        event: "issue.stale",
        url: issueUrl(baseUrl, workspace.slug, issue.id),
        issue,
      })
      if (warning) warnings.push(`${workspace.slug} issue ${issue.id}: ${warning}`)
    }
  }
  // もう止まっていない issue の印は消し、ファイルが増え続けないようにする。変わらないときは毎分書き直さない
  if (JSON.stringify(notified) !== JSON.stringify(stillStale)) {
    writeNotifiedStaleIssues(directory, stillStale)
  }
  return warnings
}

function notifiedStaleIssuesPath(directory: string): string {
  return join(directory, "notified-stale-issues.json")
}

function readNotifiedStaleIssues(directory: string): Record<string, string> {
  const path = notifiedStaleIssuesPath(directory)
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof parsed !== "object" || parsed === null) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    )
  } catch {
    // 壊れた印のファイルで見回りを止めない。最悪でも 1 度知らせ直すだけで済む
    return {}
  }
}

function writeNotifiedStaleIssues(directory: string, entries: Record<string, string>): void {
  mkdirSync(directory, { recursive: true })
  const path = notifiedStaleIssuesPath(directory)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`)
  renameSync(temporary, path)
}

function notifyEnvironment(payload: NotifyEvent): Record<string, string | undefined> {
  const subject =
    payload.event === "issue.stale"
      ? { YARU_ISSUE_ID: payload.issue.id, YARU_ISSUE_TITLE: payload.issue.title }
      : { YARU_QUESTION_ID: payload.question.id, YARU_QUESTION_TITLE: payload.question.title }
  return { ...process.env, YARU_EVENT: payload.event, YARU_URL: payload.url, ...subject }
}

function failureMessage(exitCode: number | null, stderr: string): string | null {
  if (exitCode === 0) return null
  if (exitCode === null) {
    return `notify command failed: expected to finish within ${NOTIFY_TIMEOUT_MILLISECONDS}ms, actual timed out`
  }
  const detail = stderr.trim()
  return `notify command failed: expected exit code 0, actual ${exitCode}${detail ? `: ${detail}` : ""}`
}
