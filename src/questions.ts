import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
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
  writeCreate,
  writeReplace,
  type Priority,
  type Store,
} from "./store"

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
  author: string
  answer: string | null
  answeredBy: string | null
  answeredAt: string | null
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
  body?: string
}

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
      body: input.body ?? current.body,
      canceled,
      canceledAt: canceled ? (current.canceled ? current.canceledAt : timestamp) : null,
      updatedAt: timestamp,
    }
    writeReplace(path, formatQuestion(next))
    return withStatus(next, now)
  }
  if (!input.title?.trim()) throw new Error("title is required when creating a question")
  mkdirSync(join(store.dir, "questions"), { recursive: true })
  for (;;) {
    const created: StoredQuestion = {
      id: nextQuestionId(store),
      title: singleLine(input.title),
      issue: issue ?? null,
      priority: priority ?? null,
      defaultAction: defaultAction ?? null,
      answerBy: answerBy ?? null,
      author: gitName(),
      answer: null,
      answeredBy: null,
      answeredAt: null,
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
  input: { body?: string },
  now = new Date(),
): Question {
  const path = questionPath(store, id)
  if (!existsSync(path)) throw new Error(`question not found: ${id}`)
  const current = readQuestion(path, id)
  if (current.canceled) {
    throw new Error(
      `cannot answer question ${id}: expected status open or expired, actual canceled`,
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
    updatedAt: timestamp,
  }
  writeReplace(path, formatQuestion(next))
  return withStatus(next, now)
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
  questions.sort(
    (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      b.createdAt.localeCompare(a.createdAt) ||
      Number(b.id) - Number(a.id),
  )
  return questions.filter((question) => {
    if (status && question.status !== status) return false
    if (filter.issue && question.issue !== filter.issue) return false
    return true
  })
}

// 人が答えるべきもの (open と expired) を先に、終わったものを後ろに並べる
function statusRank(status: QuestionStatus): number {
  if (status === "open" || status === "expired") return 0
  return 1
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
    author: meta.author || "",
    answer,
    answeredBy: blankToNull(meta.answeredBy ?? "") ?? null,
    answeredAt: blankToNull(meta.answeredAt ?? "") ?? null,
    canceled: meta.status === "canceled",
    canceledAt: blankToNull(meta.canceledAt ?? "") ?? null,
    createdAt: meta.createdAt || "",
    updatedAt: meta.updatedAt || "",
    body: questionBody,
  }
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
      ["author", question.author],
      ["answeredBy", question.answeredBy ?? ""],
      ["answeredAt", question.answeredAt ?? ""],
      ["canceledAt", question.canceledAt ?? ""],
      ["createdAt", question.createdAt],
      ["updatedAt", question.updatedAt],
    ],
    body,
  )
}
