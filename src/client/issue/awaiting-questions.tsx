import { useState } from "preact/hooks"
import { Button } from "../../components/button"
import { ChevronIcon } from "../../components/icons/chevron-icon"
import { QuestionIcon } from "../../components/icons/question-icon"
import { QuestionCard } from "../../components/question-card"
import type { Question } from "../../questions"
import type { ReturnedDrafts } from "../state"

// issue 画面で、答えを待っている質問を題名より上に出す。エージェントは答えを待って止まっているので、説明より先に目に入れる
// スマホ幅では質問のカードが長く、題名と説明が画面の外に押し出されるので、「2 questions awaiting answer」の 1 行にたたんでおき、
// 押すと開く。広い画面では常に開いておく
// たたむのは CSS (hidden と data-expanded) で行い、カードは描いたままにする。描き直すと書きかけの答えが消えるため
// 答えが送り返されてきた (draft) 質問があれば、最初から開いておく

export function AwaitingQuestions({
  questions,
  now,
  answerDraft,
}: {
  questions: Question[]
  now: Date
  answerDraft?: ReturnedDrafts["answer"]
}) {
  const hasDraft = questions.some((question) => question.id === answerDraft?.questionId)
  const [expanded, setExpanded] = useState(hasDraft)
  if (questions.length === 0) return null
  const count = questions.length
  return (
    <section aria-label="Questions awaiting answer" class="flex flex-col gap-3">
      <Button
        size="md"
        align="start"
        aria-expanded={expanded ? "true" : "false"}
        aria-controls="issue-awaiting-questions"
        class="group w-full md:hidden"
        onClick={() => setExpanded((current) => !current)}
      >
        <QuestionIcon />
        <span class="min-w-0 flex-1 truncate">
          {count} {count === 1 ? "question" : "questions"} awaiting answer
        </span>
        <span class="transition-transform group-aria-expanded:rotate-180">
          <ChevronIcon />
        </span>
      </Button>
      <div
        id="issue-awaiting-questions"
        data-expanded={expanded ? "" : undefined}
        class="hidden flex-col gap-3 data-expanded:flex md:flex"
      >
        {questions.map((question) => (
          <QuestionCard
            key={question.id}
            question={question}
            now={now}
            draft={answerDraft?.questionId === question.id ? answerDraft.text : undefined}
          />
        ))}
      </div>
    </section>
  )
}
