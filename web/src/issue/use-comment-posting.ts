import { useCallback, useEffect, useState } from "preact/hooks"
import type { Comment } from "../domain/comment"

// コメントを保存し、ページを読み直さずに活動欄へ足す
// 送ったコメントは、次の読み直しで同じ id が入ってくるまで手元で並べておく
// 送れなかったときは、書いた文字を欄に残して理由を出す

export function useCommentPosting({
  issueId,
  comments,
  post,
}: {
  issueId: string
  comments: Comment[]
  post: (body: string) => Promise<Comment>
}): {
  comments: Comment[]
  error: string | null
  pending: boolean
  submit: (form: HTMLFormElement) => Promise<void>
} {
  const [posted, setPosted] = useState<Comment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    setPosted([])
    setError(null)
  }, [issueId])

  const submit = useCallback(
    async (form: HTMLFormElement) => {
      const field = commentField(form)
      const body = field?.value ?? ""
      setPending(true)
      setError(null)
      try {
        const comment = await post(body)
        setPosted((current) => [...current, comment])
        if (field) field.value = ""
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setPending(false)
      }
    },
    [post],
  )

  const known = new Set(comments.map((comment) => comment.id))
  return {
    comments: [...comments, ...posted.filter((comment) => !known.has(comment.id))],
    error,
    pending,
    submit,
  }
}

// 入力欄はフォームの外にあり form 属性で結ばれている
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form
function commentField(form: HTMLFormElement): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`textarea[form="${form.id}"][name="body"]`)
}
