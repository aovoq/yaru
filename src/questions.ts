import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  blankToNull,
  formatDocument,
  getIssue,
  gitName,
  isEexist,
  joinOr,
  parseFrontmatter,
  resolvePriority,
  saveComment,
  writeCreate,
  writeReplace,
  type Priority,
  type Store,
} from "./store"
import type { Provenance } from "./provenance"

// エージェントが人に投げる非同期の質問
// 人が期限までに答えなければ、エージェントは defaultAction で進める
// 期限切れ (expired) は保存せず、読むたびに answerBy と現在時刻から決める。見張り役の常駐プロセスを要らなくするため

export const STORED_QUESTION_STATUSES = ["open", "canceled"] as const
export const QUESTION_STATUSES = ["open", "expired", "answered", "canceled"] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

// 回答は本文の後ろに区切りを挟んで書く。frontmatter は 1 行ずつなので複数行の回答を置けないため
export const QUESTION_ANSWER_MARKER = "<!-- yaru:answer -->"

export type Question = {
  id: string
  title: string
  status: QuestionStatus
  issue: string | null
  priority: Priority | null
  defaultAction: string | null
  answerBy: string | null
  // エージェントが挙げた選択肢。人は押すだけで答えられる。無ければ空
  options: string[]
  author: string
  // どのエージェントが、どの作業場所で聞いたか。並列の worktree の質問を見分けるため作成時に 1 度だけ記録する
  session: string | null
  worktree: string | null
  branch: string | null
  answer: string | null
  answeredBy: string | null
  answeredAt: string | null
  // エージェントが答えを初めて受け取った時刻。人が「読まれたか」を確かめられるようにする。答えを直すと null に戻る
  acknowledgedAt: string | null
  // 期限が近いことを知らせた時刻。serve が毎分見回るので、同じ質問を何度も知らせないために残す
  notifiedExpiringAt: string | null
  canceledAt: string | null
  createdAt: string
  updatedAt: string
  body: string
}

export type SaveQuestionInput = {
  id?: string
  title?: string
  status?: string
  issue?: string | null
  priority?: string | null
  defaultAction?: string | null
  answerBy?: string | null
  // null か空の配列で選択肢を消す
  options?: string[] | null
  // 作成時だけ記録する。作業場所は CLI を動かした場所 (process.cwd()) から読む。store.root は常に元のフォルダを指すため
  provenance?: Provenance
  // 同じ質問がまだ開いていても、あえてもう一度聞く
  force?: boolean
  body?: string
}

export type AnswerQuestionInput = {
  body?: string
  // 画面が描いたときの状態。answered なら、表示していた答えを直す意図とみなす
  expectedStatus?: string
  // 答え済みの質問の答えを置き換える
  force?: boolean
}

// 人が答える前に状態が変わっていたときの失敗。Web では 409 Conflict として返す
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10
export class QuestionConflictError extends Error {
  readonly question: Question

  constructor(message: string, question: Question) {
    super(message)
    this.name = "QuestionConflictError"
    this.question = question
  }
}

// 答えを待っている質問を、人が先に見るべき順に分けたもの
// blocking: 既定の行動が無く、答えるまでエージェントが止まっている
// dueSoon: 期限までに答えないと既定の行動で進む。期限の近い順
// noDeadline: 既定の行動はあるが期限が無い
// proceeded: 期限が過ぎ、エージェントは既定の行動で進んだ
export type AwaitingQuestionGroups<T> = {
  blocking: T[]
  dueSoon: T[]
  noDeadline: T[]
  proceeded: T[]
}

// 期限の何分前に知らせるか。知らせを見てから答えを書くのに要る時間の目安
export const EXPIRING_NOTICE_MILLISECONDS = 15 * 60_000

export type QuestionFilter = {
  status?: string
  issue?: string
}

type StoredQuestion = Omit<Question, "status"> & { canceled: boolean }

export function saveQuestion(store: Store, input: SaveQuestionInput, now = new Date()): Question {
  const status = input.status !== undefined ? resolveStoredStatus(input.status) : undefined
  const timestamp = now.toISOString()
  const priority = resolvePriority(input.priority)
  const answerBy = resolveAnswerBy(input.answerBy, now)
  const defaultAction = resolveSingleLine(input.defaultAction)
  const issue = resolveIssue(store, input.issue)
  const options = resolveOptions(input.options)
  if (input.body !== undefined) assertBody(input.body)
  if (input.id) {
    const path = questionPath(store, input.id)
    if (!existsSync(path)) throw new Error(`question not found: ${input.id}`)
    const current = readQuestion(path, input.id)
    if (input.title !== undefined && !input.title.trim()) {
      throw new Error(
        `invalid title: expected a non-empty string, actual ${JSON.stringify(input.title)}`,
      )
    }
    const canceled = status !== undefined ? status === "canceled" : current.canceled
    const next: StoredQuestion = {
      ...current,
      title: input.title !== undefined ? singleLine(input.title) : current.title,
      issue: issue !== undefined ? issue : current.issue,
      priority: priority !== undefined ? priority : current.priority,
      defaultAction: defaultAction !== undefined ? defaultAction : current.defaultAction,
      answerBy: answerBy !== undefined ? answerBy : current.answerBy,
      options: options !== undefined ? options : current.options,
      body: input.body ?? current.body,
      canceled,
      canceledAt: canceled ? (current.canceled ? current.canceledAt : timestamp) : null,
      updatedAt: timestamp,
    }
    writeReplace(path, formatQuestion(next))
    return withStatus(next, now)
  }
  if (!input.title?.trim()) throw new Error("title is required when creating a question")
  const title = singleLine(input.title)
  if (!input.force) assertNotDuplicate(store, title, issue ?? null, now)
  ensureQuestionsDirectory(store)
  for (;;) {
    const created: StoredQuestion = {
      id: nextQuestionId(store),
      title,
      issue: issue ?? null,
      priority: priority ?? null,
      defaultAction: defaultAction ?? null,
      answerBy: answerBy ?? null,
      options: options ?? [],
      author: gitName(),
      session: input.provenance?.session ?? null,
      worktree: input.provenance?.worktree ?? null,
      branch: input.provenance?.branch ?? null,
      answer: null,
      answeredBy: null,
      answeredAt: null,
      acknowledgedAt: null,
      notifiedExpiringAt: null,
      canceled: status === "canceled",
      canceledAt: status === "canceled" ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
      body: input.body ?? "",
    }
    try {
      writeCreate(questionPath(store, created.id), formatQuestion(created))
      return withStatus(created, now)
    } catch (err) {
      if (!isEexist(err)) throw err
    }
  }
}

export function answerQuestion(
  store: Store,
  id: string,
  input: AnswerQuestionInput,
  now = new Date(),
): Question {
  const path = questionPath(store, id)
  if (!existsSync(path)) throw new Error(`question not found: ${id}`)
  const current = readQuestion(path, id)
  const expectedStatus =
    input.expectedStatus !== undefined ? resolveExpectedStatus(input.expectedStatus) : undefined
  const currentStatus = statusOf(current, now)
  // 別の端末や古いタブから答えた人の答えを、黙って上書きしないようにする
  // 期限切れは読むたびに決まるので、open を見ていたタブが expired の質問に答えるのは衝突にしない
  const replacing = input.force === true || expectedStatus === "answered"
  if (currentStatus === "canceled" || (currentStatus === "answered" && !replacing)) {
    throw new QuestionConflictError(
      `cannot answer question ${id}: expected status open or expired, actual ${currentStatus}${
        currentStatus === "answered"
          ? ` (answered by ${current.answeredBy ?? "unknown"} at ${current.answeredAt ?? "unknown"}; force to replace the answer)`
          : ""
      }`,
      withStatus(current, now),
    )
  }
  if (!input.body?.trim()) {
    throw new Error(
      `invalid answer: expected a non-empty string, actual ${JSON.stringify(input.body ?? "")}`,
    )
  }
  assertBody(input.body)
  const timestamp = now.toISOString()
  const next: StoredQuestion = {
    ...current,
    answer: input.body,
    answeredBy: gitName(),
    answeredAt: timestamp,
    acknowledgedAt: null,
    updatedAt: timestamp,
  }
  writeReplace(path, formatQuestion(next))
  // 期限切れの後の答えは、エージェントが既定の行動で進んだ後に届く。作業の記録に残し、次に issue を読んだエージェントが拾えるようにする
  if (currentStatus === "expired" && current.issue !== null) {
    saveComment(store, {
      issue: current.issue,
      body: `Late answer to Q${id} (${current.title}), ${
        current.defaultAction !== null
          ? "after the agent proceeded with the default"
          : "after answerBy passed"
      }:\n\n${input.body}`,
    })
  }
  return withStatus(next, now)
}

// 答えてから取り消せるまでの時間。押し間違いや別の質問への誤答に気づくのに要る時間の目安
// エージェントが答えを読んで動き出した後に取り消すと、人とエージェントの考えが食い違うので、短く区切る
export const UNDO_ANSWER_MILLISECONDS = 30_000

export type UndoAnswerInput = {
  // 取り消したい答えの answeredAt。別の人が同じ時間内に答えを置き換えていたら、その答えを消さずに断る
  answeredAt?: string
}

// 答えたばかりの答えを消して、質問を答え待ちに戻す
// 次のどれかなら断る。答えを消すと、エージェントか issue の記録が消えた答えを元に動いてしまうため
// - エージェントが既に答えを受け取った (acknowledgedAt)
// - 答えてから UNDO_ANSWER_MILLISECONDS を過ぎた
// - 期限切れの後の答えで、issue のコメントに書き写した (コメントは消せない)
export function undoAnswer(
  store: Store,
  id: string,
  input: UndoAnswerInput,
  now = new Date(),
): Question {
  const path = questionPath(store, id)
  if (!existsSync(path)) throw new Error(`question not found: ${id}`)
  const current = readQuestion(path, id)
  const currentStatus = statusOf(current, now)
  const prefix = `cannot undo the answer to question ${id}`
  if (currentStatus !== "answered" || current.answeredAt === null) {
    throw new QuestionConflictError(
      `${prefix}: expected status answered, actual ${currentStatus}`,
      withStatus(current, now),
    )
  }
  if (input.answeredAt !== undefined && input.answeredAt !== current.answeredAt) {
    throw new QuestionConflictError(
      `${prefix}: expected answeredAt ${input.answeredAt}, actual ${current.answeredAt}`,
      withStatus(current, now),
    )
  }
  if (current.acknowledgedAt !== null) {
    throw new QuestionConflictError(
      `${prefix}: expected the agent not to have picked it up, actual picked up at ${current.acknowledgedAt}`,
      withStatus(current, now),
    )
  }
  const elapsed = now.getTime() - Date.parse(current.answeredAt)
  if (elapsed > UNDO_ANSWER_MILLISECONDS) {
    throw new Error(
      `${prefix}: expected within ${UNDO_ANSWER_MILLISECONDS / 1000}s of answering, actual ${Math.round(elapsed / 1000)}s`,
    )
  }
  if (isLateAnswer(current.issue, current.answerBy, current.answeredAt)) {
    throw new Error(
      `${prefix}: expected an answer before answerBy, actual a late answer already added to issue ${current.issue} as a comment`,
    )
  }
  const next: StoredQuestion = {
    ...current,
    answer: null,
    answeredBy: null,
    answeredAt: null,
    acknowledgedAt: null,
    updatedAt: now.toISOString(),
  }
  writeReplace(path, formatQuestion(next))
  return withStatus(next, now)
}

// 取り消しの時間が終わる時刻。取り消せない答え (答え待ち・エージェントが受け取った・issue に書き写した) なら null
// 画面は、断られると分かっている取り消しのボタンを出さないためにこれを見る
export function undoAnswerDeadline(question: Question): Date | null {
  if (question.status !== "answered" || question.answeredAt === null) return null
  if (question.acknowledgedAt !== null) return null
  if (isLateAnswer(question.issue, question.answerBy, question.answeredAt)) return null
  return new Date(Date.parse(question.answeredAt) + UNDO_ANSWER_MILLISECONDS)
}

// answerQuestion が期限切れの後の答えを issue のコメントに書き写したか
function isLateAnswer(issue: string | null, answerBy: string | null, answeredAt: string): boolean {
  if (issue === null || answerBy === null) return false
  return Date.parse(answerBy) <= Date.parse(answeredAt)
}

// 答えを待っている質問を取り下げる。答え済みの質問は、答えを読んだエージェントが既に動いているかもしれないので取り下げさせない
export function cancelQuestion(store: Store, id: string, now = new Date()): Question {
  const path = questionPath(store, id)
  if (!existsSync(path)) throw new Error(`question not found: ${id}`)
  const current = readQuestion(path, id)
  const currentStatus = statusOf(current, now)
  if (currentStatus === "canceled") return withStatus(current, now)
  if (currentStatus === "answered") {
    throw new QuestionConflictError(
      `cannot cancel question ${id}: expected status open or expired, actual answered`,
      withStatus(current, now),
    )
  }
  return saveQuestion(store, { id, status: "canceled" }, now)
}

// エージェントが答えを初めて受け取った時刻を残す。並びが揺れないよう updatedAt は変えない
export function acknowledgeQuestion(store: Store, id: string, now = new Date()): Question {
  const path = questionPath(store, id)
  if (!existsSync(path)) throw new Error(`question not found: ${id}`)
  const current = readQuestion(path, id)
  if (statusOf(current, now) !== "answered" || current.acknowledgedAt !== null) {
    return withStatus(current, now)
  }
  const next: StoredQuestion = { ...current, acknowledgedAt: now.toISOString() }
  writeReplace(path, formatQuestion(next))
  return withStatus(next, now)
}

// 期限が近いことを知らせた時刻を残す。並びが揺れないよう updatedAt は変えない
export function markExpiringNotified(store: Store, id: string, now = new Date()): Question {
  const path = questionPath(store, id)
  if (!existsSync(path)) throw new Error(`question not found: ${id}`)
  const next: StoredQuestion = { ...readQuestion(path, id), notifiedExpiringAt: now.toISOString() }
  writeReplace(path, formatQuestion(next))
  return withStatus(next, now)
}

// 期限が EXPIRING_NOTICE_MILLISECONDS 以内に来る、まだ知らせていない open の質問
// 最初から期限がその幅より短い質問は、作ったときの知らせと続けて届くだけなので除く
export function questionsAboutToExpire(questions: Question[], now: Date): Question[] {
  return questions.filter((question) => {
    if (question.status !== "open" || question.answerBy === null) return false
    if (question.notifiedExpiringAt !== null) return false
    const answerBy = Date.parse(question.answerBy)
    if (answerBy - Date.parse(question.createdAt) <= EXPIRING_NOTICE_MILLISECONDS) return false
    return answerBy - now.getTime() <= EXPIRING_NOTICE_MILLISECONDS
  })
}

export function getQuestion(store: Store, id: string, now = new Date()): Question {
  const path = questionPath(store, id)
  if (!existsSync(path)) throw new Error(`question not found: ${id}`)
  return withStatus(readQuestion(path, id), now)
}

export function listQuestions(
  store: Store,
  filter: QuestionFilter = {},
  now = new Date(),
): Question[] {
  const status = filter.status !== undefined ? resolveStatus(filter.status) : undefined
  const questions = loadRawQuestions(store).map((question) => withStatus(question, now))
  questions.sort(compareQuestions)
  return questions.filter((question) => {
    if (status && question.status !== status) return false
    if (filter.issue && question.issue !== filter.issue) return false
    return true
  })
}

// 人が先に見るべき順に並べる
// 1. 止まっている (既定の行動が無い) 質問。長く待たせているものから
// 2. 期限までに答えないと既定の行動で進む質問。期限の近いものから
// 3. 期限の無い質問。新しいものから
// 4. 期限が過ぎて既定の行動で進んだ質問。期限が最近過ぎたものから
// 5. 答え済みと取り下げた質問。最近片付いたものから
// ワークスペースをまたいで混ぜるときも同じ順にするため export する
export function compareQuestions(a: Question, b: Question): number {
  const rank = questionRank(a) - questionRank(b)
  if (rank !== 0) return rank
  switch (questionRank(a)) {
    case 0:
      return (
        compareAnswerBy(a, b) || a.createdAt.localeCompare(b.createdAt) || compareIdAscending(a, b)
      )
    case 1:
      return compareAnswerBy(a, b) || compareIdAscending(a, b)
    case 2:
      return b.createdAt.localeCompare(a.createdAt) || compareIdAscending(b, a)
    case 3:
      return (b.answerBy ?? "").localeCompare(a.answerBy ?? "") || compareIdAscending(b, a)
    default:
      return resolvedAt(b).localeCompare(resolvedAt(a)) || compareIdAscending(b, a)
  }
}

export function groupAwaitingQuestions(questions: Question[]): AwaitingQuestionGroups<Question>
export function groupAwaitingQuestions<T>(
  items: T[],
  questionOf: (item: T) => Question,
): AwaitingQuestionGroups<T>
export function groupAwaitingQuestions<T>(
  items: T[],
  questionOf: (item: T) => Question = (item) => item as Question,
): AwaitingQuestionGroups<T> {
  const groups: AwaitingQuestionGroups<T> = {
    blocking: [],
    dueSoon: [],
    noDeadline: [],
    proceeded: [],
  }
  const keys = ["blocking", "dueSoon", "noDeadline", "proceeded"] as const
  const sorted = [...items].sort((a, b) => compareQuestions(questionOf(a), questionOf(b)))
  for (const item of sorted) {
    const key = keys[questionRank(questionOf(item))]
    if (key) groups[key].push(item)
  }
  return groups
}

function questionRank(question: Question): number {
  if (question.status === "open") {
    if (question.defaultAction === null) return 0
    return question.answerBy !== null ? 1 : 2
  }
  if (question.status === "expired") return 3
  return 4
}

// 期限の無いものは期限のあるものより後ろにする
function compareAnswerBy(a: Question, b: Question): number {
  if (a.answerBy === b.answerBy) return 0
  if (a.answerBy === null) return 1
  if (b.answerBy === null) return -1
  return a.answerBy.localeCompare(b.answerBy)
}

function compareIdAscending(a: Question, b: Question): number {
  return Number(a.id) - Number(b.id)
}

function resolvedAt(question: Question): string {
  return question.answeredAt ?? question.canceledAt ?? question.createdAt
}

function withStatus(question: StoredQuestion, now: Date): Question {
  const { canceled, ...rest } = question
  return { ...rest, status: statusOf(question, now) }
}

function statusOf(question: StoredQuestion, now: Date): QuestionStatus {
  if (question.canceled) return "canceled"
  if (question.answer !== null) return "answered"
  if (question.answerBy !== null && Date.parse(question.answerBy) <= now.getTime()) {
    return "expired"
  }
  return "open"
}

function resolveStoredStatus(value: string): (typeof STORED_QUESTION_STATUSES)[number] {
  const trimmed = value.trim()
  if (!(STORED_QUESTION_STATUSES as readonly string[]).includes(trimmed)) {
    throw new Error(`invalid status: expected ${joinOr(STORED_QUESTION_STATUSES)}, actual ${value}`)
  }
  return trimmed as (typeof STORED_QUESTION_STATUSES)[number]
}

function resolveStatus(value: string): QuestionStatus {
  const trimmed = value.trim()
  if (!(QUESTION_STATUSES as readonly string[]).includes(trimmed)) {
    throw new Error(`invalid status: expected ${joinOr(QUESTION_STATUSES)}, actual ${value}`)
  }
  return trimmed as QuestionStatus
}

function resolveExpectedStatus(value: string): QuestionStatus {
  const trimmed = value.trim()
  if (!(QUESTION_STATUSES as readonly string[]).includes(trimmed)) {
    throw new Error(
      `invalid expectedStatus: expected ${joinOr(QUESTION_STATUSES)}, actual ${value}`,
    )
  }
  return trimmed as QuestionStatus
}

function resolveOptions(value: string[] | null | undefined): string[] | undefined {
  if (value === undefined) return undefined
  if (value === null) return []
  const options: string[] = []
  for (const option of value) {
    const resolved = singleLine(option)
    if (!resolved) {
      throw new Error(
        `invalid option: expected a non-empty string, actual ${JSON.stringify(option)}`,
      )
    }
    if (options.includes(resolved)) {
      throw new Error(
        `invalid option: expected each option once, actual ${JSON.stringify(resolved)} twice`,
      )
    }
    options.push(resolved)
  }
  return options
}

// エージェントが待ちきれずに同じことを聞き直すと、人の画面に同じ質問が並んで答えが割れるため断る
function assertNotDuplicate(store: Store, title: string, issue: string | null, now: Date): void {
  const existing = loadRawQuestions(store)
    .map((question) => withStatus(question, now))
    .find(
      (question) =>
        question.status === "open" && question.title === title && question.issue === issue,
    )
  if (!existing) return
  throw new Error(
    `duplicate question: expected no open question titled ${JSON.stringify(title)} ${
      issue === null ? "without an issue" : `on issue ${issue}`
    }, actual question ${existing.id} is open; force to ask again`,
  )
}

const DURATION_UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

// エージェントは「2 時間後」のような相対指定で期限を切ることが多いので、30m / 2h / 1d を受ける
// 絶対時刻は ISO 8601 の日時 (RFC 3339) で受ける。日付だけだとタイムゾーンが曖昧になるため受けない
// https://www.rfc-editor.org/rfc/rfc3339#section-5.6
export function resolveAnswerBy(
  value: string | null | undefined,
  now: Date,
): string | null | undefined {
  const resolved = blankToNull(value)
  if (resolved === undefined || resolved === null) return resolved
  const duration = resolved.match(/^(\d+)([mhd])$/)
  if (duration) {
    return new Date(
      now.getTime() + Number(duration[1]) * DURATION_UNITS[duration[2]!]!,
    ).toISOString()
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(resolved)) {
    const parsed = Date.parse(resolved)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  throw new Error(
    `invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual ${value}`,
  )
}

function resolveIssue(store: Store, value: string | null | undefined): string | null | undefined {
  const resolved = blankToNull(value)
  if (resolved === undefined || resolved === null) return resolved
  getIssue(store, resolved)
  return resolved
}

function resolveSingleLine(value: string | null | undefined): string | null | undefined {
  const resolved = blankToNull(value)
  if (resolved === undefined || resolved === null) return resolved
  return singleLine(resolved)
}

function singleLine(value: string): string {
  return value.replace(/\s*\n\s*/g, " ").trim()
}

function assertBody(body: string): void {
  if (body.includes(QUESTION_ANSWER_MARKER)) {
    throw new Error(`invalid body: must not contain ${QUESTION_ANSWER_MARKER}`)
  }
}

// 質問はやり取りの最中の状態で、記録として残す issue と違ってブランチごとに分かれると困るので git に入れない
// リポジトリ側の .gitignore を書き換えずに済むよう、フォルダの中に自分自身ごと無視する .gitignore を置く
// https://git-scm.com/docs/gitignore
export function ensureQuestionsDirectory(store: Store): string {
  const directory = join(store.dir, "questions")
  mkdirSync(directory, { recursive: true })
  const ignore = join(directory, ".gitignore")
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n")
  return directory
}

function questionPath(store: Store, id: string): string {
  return join(store.dir, "questions", `${id}.md`)
}

function nextQuestionId(store: Store): string {
  const dir = join(store.dir, "questions")
  let max = 0
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const match = name.match(/^(\d+)\.md$/)
      if (!match) continue
      const number = Number(match[1])
      if (number > max) max = number
    }
  }
  return String(max + 1)
}

function loadRawQuestions(store: Store): StoredQuestion[] {
  const dir = join(store.dir, "questions")
  if (!existsSync(dir)) return []
  const questions: StoredQuestion[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue
    try {
      questions.push(readQuestion(join(dir, name), name.slice(0, -3)))
    } catch {
      // 壊れた手編集ファイルが一覧全体を隠さないようにする
    }
  }
  return questions
}

function readQuestion(path: string, stem: string): StoredQuestion {
  const { meta, body } = parseFrontmatter(readFileSync(path, "utf8"))
  if (!meta.title) throw new Error("invalid question file")
  const markerIndex = body.indexOf(QUESTION_ANSWER_MARKER)
  const questionBody = markerIndex < 0 ? body : body.slice(0, markerIndex).replace(/\n\n$/, "")
  const answer =
    markerIndex < 0
      ? null
      : body.slice(markerIndex + QUESTION_ANSWER_MARKER.length).replace(/^\n\n/, "")
  return {
    id: stem,
    title: meta.title,
    issue: blankToNull(meta.issue ?? "") ?? null,
    priority: resolvePriority(meta.priority ?? "") ?? null,
    defaultAction: blankToNull(meta.defaultAction ?? "") ?? null,
    answerBy: blankToNull(meta.answerBy ?? "") ?? null,
    options: parseOptions(meta.options ?? ""),
    author: meta.author || "",
    session: blankToNull(meta.session ?? "") ?? null,
    worktree: blankToNull(meta.worktree ?? "") ?? null,
    branch: blankToNull(meta.branch ?? "") ?? null,
    answer,
    answeredBy: blankToNull(meta.answeredBy ?? "") ?? null,
    answeredAt: blankToNull(meta.answeredAt ?? "") ?? null,
    acknowledgedAt: blankToNull(meta.acknowledgedAt ?? "") ?? null,
    notifiedExpiringAt: blankToNull(meta.notifiedExpiringAt ?? "") ?? null,
    canceled: meta.status === "canceled",
    canceledAt: blankToNull(meta.canceledAt ?? "") ?? null,
    createdAt: meta.createdAt || "",
    updatedAt: meta.updatedAt || "",
    body: questionBody,
  }
}

// 選択肢は読点やカンマを含む文になりやすいので、区切り文字で並べず 1 行の JSON 配列で書く
// https://www.rfc-editor.org/rfc/rfc8259
function parseOptions(value: string): string[] {
  if (!value.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("invalid question file")
  }
  if (!Array.isArray(parsed) || !parsed.every((option) => typeof option === "string")) {
    throw new Error("invalid question file")
  }
  return parsed
}

function formatQuestion(question: StoredQuestion): string {
  const body =
    question.answer === null
      ? question.body
      : question.body
        ? `${question.body}\n\n${QUESTION_ANSWER_MARKER}\n\n${question.answer}`
        : `${QUESTION_ANSWER_MARKER}\n\n${question.answer}`
  return formatDocument(
    [
      ["id", question.id],
      ["title", question.title],
      ["status", question.canceled ? "canceled" : "open"],
      ["issue", question.issue ?? ""],
      ["priority", question.priority ?? ""],
      ["defaultAction", question.defaultAction ?? ""],
      ["answerBy", question.answerBy ?? ""],
      ["options", question.options.length > 0 ? JSON.stringify(question.options) : ""],
      ["author", question.author],
      ["session", question.session ?? ""],
      ["worktree", question.worktree ?? ""],
      ["branch", question.branch ?? ""],
      ["answeredBy", question.answeredBy ?? ""],
      ["answeredAt", question.answeredAt ?? ""],
      ["acknowledgedAt", question.acknowledgedAt ?? ""],
      ["notifiedExpiringAt", question.notifiedExpiringAt ?? ""],
      ["canceledAt", question.canceledAt ?? ""],
      ["createdAt", question.createdAt],
      ["updatedAt", question.updatedAt],
    ],
    body,
  )
}
