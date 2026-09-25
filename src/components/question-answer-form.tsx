import type { Question } from "../questions"
import { answerFormId, cancelFormId, isAwaitingAnswer, optionFormId } from "./question-answer"

// カードの入力欄とボタンが送る先のフォーム。答え待ちの質問ごとに、フォームの入れ子にならない場所へ置く
// 回答欄のフォームに加え、選択肢があれば選択肢のフォームを、期限切れなら取り下げ (Dismiss) のフォームを置く
// returnTo は送ったあとに戻る板の URL。無ければ dashboard に戻る
// expectedStatus はカードを描いたときの状態。別のタブや端末で先に答えられていたら、サーバーが上書きせずに断る (409)
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10
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
  const questionPath = `${basePath}/questions/${encodeURIComponent(question.id)}`
  const hiddenInputs = (
    <>
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <input type="hidden" name="expectedStatus" value={question.status} />
    </>
  )
  return (
    <>
      <form id={answerFormId(question)} method="post" action={`${questionPath}/answer`} hidden>
        {hiddenInputs}
      </form>
      {question.options.length > 0 ? (
        <form id={optionFormId(question)} method="post" action={`${questionPath}/answer`} hidden>
          {hiddenInputs}
        </form>
      ) : null}
      {question.status === "expired" ? (
        <form id={cancelFormId(question)} method="post" action={`${questionPath}/cancel`} hidden>
          {hiddenInputs}
        </form>
      ) : null}
    </>
  )
}
