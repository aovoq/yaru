import { useState } from "preact/hooks"
import { Button } from "../components/button"
import { ChevronIcon } from "../components/icons/chevron-icon"
import { QuestionIcon } from "../components/icons/question-icon"
import { QuestionCard } from "../components/question-card"
import type { Question } from "../domain/question"
import type { ReturnedDrafts } from "./model"

// 答えを待っている質問を題名より上に出す
// スマホ幅では 1 行にたたみ、広い画面では常に開いておく。カードは描いたままにし、書きかけの答えが消えないようにする

export function AwaitingQuestions({
  questions,
  now,
  answerDraft,
  questionError,
}: {
  questions: Question[]
  now: Date
  answerDraft?: ReturnedDrafts["answer"]
  questionError?: { questionId: string; message: string }
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
            error={questionError?.questionId === question.id ? questionError.message : undefined}
          />
        ))}
      </div>
    </section>
  )
}
