import { EmptyState } from "../components/empty-state"
import { QuestionAnswerForm, QuestionCard } from "../components/question-card"
import { Section } from "../components/section"
import type { Question } from "../questions"

// dashboard の質問のまとまり。答え待ちの質問と、最近答えた質問を issue 画面と同じカードで見せる
// 回答のフォームには returnTo を渡さないので、答えたあとは dashboard に戻る

type IssueTitles = ReadonlyMap<string, string>

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
          <>
            <QuestionCard
              question={question}
              now={now}
              issueLink={issueLinkFor(question, issueTitles, basePath)}
            />
            <QuestionAnswerForm question={question} basePath={basePath} />
          </>
        ))
      )}
    </Section>
  )
}

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

function issueLinkFor(
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
