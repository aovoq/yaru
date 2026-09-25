import { Fragment } from "preact"
import { EmptyState } from "../components/empty-state"
import { QuestionAnswerForm } from "../components/question-answer-form"
import { QuestionCard } from "../components/question-card"
import { Section } from "../components/section"
import type { Question } from "../questions"
import { issueLinkFor, type IssueTitles } from "./issue-link-for"

// dashboard の答え待ちの質問のまとまり。issue 画面と同じカードで見せ、その場で答えられるようにする
// 回答のフォームには returnTo を渡さないので、答えたあとは dashboard に戻る

export function AwaitingQuestionsSection({
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
    <Section title="Questions" count={questions.length}>
      {questions.length === 0 ? (
        <EmptyState>No questions awaiting an answer</EmptyState>
      ) : (
        questions.map((question) => (
          <Fragment key={question.id}>
            <QuestionCard
              question={question}
              now={now}
              issueLink={issueLinkFor(question, issueTitles, basePath)}
            />
            <QuestionAnswerForm question={question} basePath={basePath} />
          </Fragment>
        ))
      )}
    </Section>
  )
}
