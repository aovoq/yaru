// 回答・取り下げ・取り消しのフォームを RPC に読み替える。スクリプト無しの POST はしない
// docs/spec/routes.md の「決定」1。本文の展開は src/web.tsx:141-144、src/dashboard.tsx:60

export const USE_DEFAULT_ANSWER_PREFIX = "Go with the default action: "

const NEXT_FRAGMENT = /^[A-Za-z][A-Za-z0-9._-]*$/

export type QuestionActionKind = "answer" | "cancel" | "undo"

export type QuestionAction = {
  workspace: string
  id: string
  kind: QuestionActionKind
  expectedStatus: string
  next: string | null
  returnTo: string
  body: string
  useDefault: boolean
  answeredAt: string
}

export function readQuestionAction(
  form: HTMLFormElement,
  submitter: Element | null,
): QuestionAction | null {
  const parsed = parseAction(form.action)
  if (parsed === null) return null
  return {
    ...parsed,
    expectedStatus: inputValue(form, "expectedStatus"),
    next: nextFragment(inputValue(form, "next")),
    returnTo: inputValue(form, "returnTo"),
    body: submittedBody(form, submitter),
    useDefault: submitter instanceof HTMLButtonElement && submitter.name === "useDefault",
    answeredAt: inputValue(form, "answeredAt"),
  }
}

export function answerBody(action: QuestionAction, defaultAction: string | null): string {
  if (action.useDefault) return `${USE_DEFAULT_ANSWER_PREFIX}${defaultAction ?? ""}`
  return action.body
}

export function typedAnswer(question: {
  answer: string | null
  options: readonly string[]
}): string {
  const answer = question.answer ?? ""
  if (answer.startsWith(USE_DEFAULT_ANSWER_PREFIX) || question.options.includes(answer)) return ""
  return answer
}

export function nextFragment(next: string): string | null {
  return NEXT_FRAGMENT.test(next) ? next : null
}

export function submitterOf(event: Event): Element | null {
  if (!("submitter" in event)) return null
  const submitter = (event as Event & { submitter?: EventTarget | null }).submitter
  return submitter instanceof Element ? submitter : null
}

function parseAction(
  action: string,
): { workspace: string; id: string; kind: QuestionActionKind } | null {
  let pathname: string
  try {
    pathname = new URL(action, location.href).pathname
  } catch {
    return null
  }
  const match = /^(?:\/p\/([^/]+))?\/questions\/([^/]+)\/(answer|cancel|undo)$/.exec(pathname)
  if (match === null) return null
  const workspace = match[1] === undefined ? "" : decodeURIComponent(match[1])
  const id = decodeURIComponent(match[2] ?? "")
  const kind = match[3]
  if (id === "" || (kind !== "answer" && kind !== "cancel" && kind !== "undo")) return null
  return { workspace, id, kind }
}

function submittedBody(form: HTMLFormElement, submitter: Element | null): string {
  if (submitter instanceof HTMLButtonElement && submitter.name === "body") return submitter.value
  const selector = `textarea[form="${escapeAttribute(form.id)}"][name="body"]`
  const box = document.querySelector(selector)
  return box instanceof HTMLTextAreaElement ? box.value : ""
}

function inputValue(form: HTMLFormElement, name: string): string {
  const field = form.querySelector(`input[name="${escapeAttribute(name)}"]`)
  return field instanceof HTMLInputElement ? field.value : ""
}

function escapeAttribute(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value)
  return value.replace(/["\\]/g, "\\$&")
}
