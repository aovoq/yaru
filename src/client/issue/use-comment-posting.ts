import { useCallback, useEffect, useState } from "preact/hooks"
import type { Comment } from "../../store"

// コメントを /api/comments へ送り、ページを読み直さずに活動欄へ足す
// 送ったコメントは、次に板を読み直して props の comments に入ってくるまで手元で並べておく
// 読み直した comments に同じ id が入ったら手元の分は重ねて出さない
// 送るのに失敗したら、書いた文字は欄に残したまま理由を出す。JavaScript が動かないときは #comment-form の POST がそのまま働く

export function useCommentPosting({
  basePath,
  issueId,
  comments,
}: {
  basePath: string
  issueId: string
  comments: Comment[]
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
        const response = await fetch(`${basePath}/api/comments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ issue: issueId, body }),
        })
        if (!response.ok) throw new Error(await responseError(response))
        const comment = (await response.json()) as Comment
        setPosted((current) => [...current, comment])
        if (field) field.value = ""
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setPending(false)
      }
    },
    [basePath, issueId],
  )

  const known = new Set(comments.map((comment) => comment.id))
  return {
    comments: [...comments, ...posted.filter((comment) => !known.has(comment.id))],
    error,
    pending,
    submit,
  }
}

// 入力欄はフォームの外にあり form 属性でフォームに結ばれているので、フォームの id から探す
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form
function commentField(form: HTMLFormElement): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`textarea[form="${form.id}"][name="body"]`)
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === "string"
    ? body.error
    : `comment request failed: expected successful response, actual ${response.status}`
}
