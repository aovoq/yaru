import { QuestionCard } from "../components/question-card"
import { Section } from "../components/section"
import type { Question } from "../questions"
import { issueLinkFor, type IssueTitles } from "./issue-link-for"

// dashboard の最近答えた質問のまとまり
// 答えを見返すときも、何を聞かれて何が既定だったかと並べて読めるよう、答え待ちと同じカードで見せる

export function RecentlyAnsweredSection({
  questions,
  issueTitles,
  basePath,
  now,
}: {
  questions: Question[]
  issueTitles: IssueTitles
  basePath: string
  now: Date
}) {
  return (
    <Section title="Recently answered" count={questions.length}>
      {questions.map((question) => (
        <QuestionCard
          question={question}
          now={now}
          issueLink={issueLinkFor(question, issueTitles, basePath)}
        />
      ))}
    </Section>
  )
}
