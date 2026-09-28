import { issueLinkFor, type IssueTitles } from "../components/issue-link-for"
import { QuestionCard } from "../components/question-card"
import { Section } from "../components/section"
import type { Question } from "../domain/question"

// dashboard の最近答えた質問。src/dashboard/recently-answered-section.tsx

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
          key={question.id}
          question={question}
          now={now}
          issueLink={issueLinkFor(question, issueTitles, basePath)}
        />
      ))}
    </Section>
  )
}
