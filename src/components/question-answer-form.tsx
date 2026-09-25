import type { Question } from "../questions"
import { answerFormId, isAwaitingAnswer } from "./question-answer"

// カードの入力欄が送る先のフォーム。答え待ちの質問ごとに、フォームの入れ子にならない場所へ置く
// returnTo は回答後に戻る板の URL。無ければ dashboard に戻る
export function QuestionAnswerForm({
  question,
  basePath,
  returnTo,
}: {
  question: Question
  basePath: string
  returnTo?: string
}) {
  if (!isAwaitingAnswer(question)) return null
  return (
    <form
      id={answerFormId(question)}
      method="post"
      action={`${basePath}/questions/${encodeURIComponent(question.id)}/answer`}
      hidden
    >
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    </form>
  )
}
