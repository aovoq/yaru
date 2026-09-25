import type { Question } from "../questions"
import type { Issue } from "../store"

// セッションが聞いた質問と、作った issue。質問と issue には作ったときのセッションの id (provenance.ts) が残るので、
// セッションの一覧の id と突き合わせ、どのエージェントが何をしているかを dashboard から辿れるようにする

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
    // 取り下げた質問は dashboard にカードが無く、リンクの飛び先が無いので並べない
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
