import { AnswerUndoToast } from "../components/answer-undo-toast"
import { undoAnswerDeadline, type Question } from "../questions"

// 答えた直後に戻ってきた画面 (dashboard と /inbox) に出す知らせを、答えた質問から決める
// 取り消せる間は取り消しを添え、取り消せない答え (エージェントが既に受け取った) は少しの間だけ答えたことを知らせる
// 時間を過ぎてから読み直したときは出さない

// 取り消せない答えの知らせを出しておく時間
const ANSWERED_NOTICE_MILLISECONDS = 5_000

export function AnsweredToast({
  question,
  basePath,
  returnTo,
  now,
}: {
  question: Question
  // 答えた質問のワークスペースの URL の接頭辞
  basePath: string
  returnTo: string
  now: Date
}) {
  if (question.status !== "answered" || question.answeredAt === null) return null
  const undoUntil = undoAnswerDeadline(question)
  const expiresAt =
    undoUntil ?? new Date(Date.parse(question.answeredAt) + ANSWERED_NOTICE_MILLISECONDS)
  if (expiresAt.getTime() <= now.getTime()) return null
  return (
    <AnswerUndoToast
      question={question}
      basePath={basePath}
      returnTo={returnTo}
      undoUntil={undoUntil?.toISOString() ?? null}
      expiresAt={expiresAt.toISOString()}
    />
  )
}
