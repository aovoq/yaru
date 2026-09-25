import type { Question } from "../questions"

// 質問のカードに添える、質問が紐づく issue へのリンクを作る。dashboard の答え待ちと最近答えたのまとまり、/inbox で使う

export type IssueTitles = ReadonlyMap<string, string>

export function issueLinkFor(
  question: Question,
  issueTitles: IssueTitles,
  basePath: string,
): { href: string; title: string } | undefined {
  if (!question.issue) return undefined
  return {
    href: `${basePath}/?id=${encodeURIComponent(question.issue)}`,
    title: issueTitles.get(question.issue) ?? "",
  }
}
