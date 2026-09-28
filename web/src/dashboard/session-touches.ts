import type { Issue } from "../domain/issue"
import type { Question } from "../domain/question"

// セッションが聞いた質問と、作った issue。src/dashboard/session-touches.ts

export type SessionTouches = {
  questions: { id: string; title: string; href: string }[]
  issues: { id: string; title: string; href: string }[]
}

export function sessionTouches(
  questions: Question[],
  issues: Issue[],
  basePath: string,
): Map<string, SessionTouches> {
  const touches = new Map<string, SessionTouches>()
  const touchesOf = (session: string) => {
    let touch = touches.get(session)
    if (!touch) {
      touch = { questions: [], issues: [] }
      touches.set(session, touch)
    }
    return touch
  }
  for (const question of questions) {
    if (question.session === null || question.status === "canceled") continue
    touchesOf(question.session).questions.push({
      id: question.id,
      title: question.title,
      href: `${basePath}/dashboard#q-${encodeURIComponent(question.id)}`,
    })
  }
  for (const issue of issues) {
    if (issue.session === null) continue
    touchesOf(issue.session).issues.push({
      id: issue.id,
      title: issue.title,
      href: `${basePath}/?id=${encodeURIComponent(issue.id)}`,
    })
  }
  return touches
}
