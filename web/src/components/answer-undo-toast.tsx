import type { Question } from "../domain/question"
import { Button } from "./button"

// 答えを送った直後に画面の下に出す知らせ。「Answered Q12」と、取り消せる間は「Undo」を並べる
// 答えたカードは答え待ちから外れて見えなくなるので、どの質問に答えたかをここで確かめ、押し間違いならすぐ戻せるようにする
//
// 取り消しは answeredAt を添えた POST で送る。別の人が同じ間に答えを置き換えていたら、その答えを消さずにサーバーが断る
// 取り消せるか (undoUntil) と、いつ消すか (expiresAt) は画面が questions.ts の undoAnswerDeadline から決めて渡す
// この部品はブラウザでも読まれる場所にあり、node:fs を読む questions.ts を値として読み込めないため
//
// 読み上げは、読み込んだ時点で既にある live region の中身を読まないことが多い
// そのため読み上げ用の枠 (data-announce) は空で描き、読み込んだ後に画面のスクリプト (live-page.ts) が文を入れる
// https://www.w3.org/TR/wai-aria-1.2/#status

export function AnswerUndoToast({
  question,
  basePath,
  returnTo,
  undoUntil,
  expiresAt,
}: {
  question: Question
  // 答えた質問のワークスペースの URL の接頭辞。/inbox では画面ではなく質問のワークスペースのもの
  basePath: string
  returnTo: string
  // 取り消せる最後の時刻。取り消せない答え (エージェントが受け取ったなど) なら null
  undoUntil: string | null
  // 知らせを消す時刻
  expiresAt: string
}) {
  const message = `Answered Q${question.id}`
  return (
    <div
      id="answer-toast"
      data-toast-expires-at={expiresAt}
      class="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div class="flex max-w-full items-center gap-3 rounded-lg border border-hairline-strong bg-surface-3 py-1.5 pr-1.5 pl-3 shadow-lg shadow-black/50">
        <p aria-hidden="true" class="text-body min-w-0 truncate text-ink">
          {message}
          <span class="text-ink-subtle"> — {question.title}</span>
        </p>
        <span role="status" aria-live="polite" data-announce={message} class="sr-only" />
        {undoUntil !== null && question.answeredAt !== null ? (
          <form
            method="post"
            action={`${basePath}/questions/${encodeURIComponent(question.id)}/undo`}
            data-undo-until={undoUntil}
            class="shrink-0"
          >
            <input type="hidden" name="answeredAt" value={question.answeredAt} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" variant="secondary" size="md">
              Undo
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  )
}
