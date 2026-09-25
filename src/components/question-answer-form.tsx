import type { Question } from "../questions"
import { answerFormId, cancelFormId, isAwaitingAnswer, optionFormId } from "./question-answer"

// カードの入力欄とボタンが送る先のフォーム。答え待ちの質問ごとに、フォームの入れ子にならない場所へ置く
// 回答欄のフォームに加え、選択肢があれば選択肢のフォームを、期限切れなら取り下げ (Dismiss) のフォームを置く
// returnTo は送ったあとに戻る板の URL。無ければ dashboard に戻る
// next は答えたあとに戻り先で開く次のカードの id。答えたカードは答え待ちから外れるので、続けて次の質問に答えられるようにする
// scope は複数のワークスペースの質問を並べるときのワークスペースの名前 (question-answer.ts)
// expectedStatus はカードを描いたときの状態。別のタブや端末で先に答えられていたら、サーバーが上書きせずに断る (409)
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10
export function QuestionAnswerForm({
  question,
  basePath,
  returnTo,
  next,
  scope,
}: {
  question: Question
  basePath: string
  returnTo?: string
  next?: string
  scope?: string
}) {
  if (!isAwaitingAnswer(question)) return null
  const questionPath = `${basePath}/questions/${encodeURIComponent(question.id)}`
  const hiddenInputs = (
    <>
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <input type="hidden" name="expectedStatus" value={question.status} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
    </>
  )
  return (
    <>
      <form
        id={answerFormId(question, scope)}
        method="post"
        action={`${questionPath}/answer`}
        hidden
      >
        {hiddenInputs}
      </form>
      {question.options.length > 0 ? (
        <form
          id={optionFormId(question, scope)}
          method="post"
          action={`${questionPath}/answer`}
          hidden
        >
          {hiddenInputs}
        </form>
      ) : null}
      {question.status === "expired" ? (
        <form
          id={cancelFormId(question, scope)}
          method="post"
          action={`${questionPath}/cancel`}
          hidden
        >
          {hiddenInputs}
        </form>
      ) : null}
    </>
  )
}
