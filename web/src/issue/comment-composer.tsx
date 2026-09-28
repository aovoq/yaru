import { Button } from "../components/button"
import { Kbd } from "../components/kbd"
import { submitAnswerOnModifierEnter } from "../components/question-answer"
import { Textarea } from "../components/textarea"

// 活動欄の下のコメント欄。issue を保存するフォームの中に置くので、form 属性で外の #comment-form へ送る
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form

export function CommentComposer({
  draft,
  error,
  pending,
}: {
  draft?: string
  error: string | null
  pending: boolean
}) {
  return (
    <div class="flex flex-col gap-2">
      <Textarea
        form="comment-form"
        name="body"
        required
        aria-label="Comment"
        aria-keyshortcuts="Meta+Enter Control+Enter"
        aria-describedby={error ? "comment-error" : undefined}
        placeholder="Leave a comment…"
        defaultValue={draft}
        onKeyDown={submitAnswerOnModifierEnter}
        class="min-h-20 resize-y"
      />
      {error ? (
        <p
          id="comment-error"
          data-comment-error=""
          role="alert"
          class="text-small text-semantic-danger"
        >
          {error}
        </p>
      ) : null}
      <div class="flex justify-end">
        <Button type="submit" form="comment-form" size="md" disabled={pending}>
          Comment
          <span aria-hidden="true" class="hidden items-center gap-0.5 sm:inline-flex">
            <Kbd>⌘</Kbd>
            <Kbd>⏎</Kbd>
          </span>
        </Button>
      </div>
    </div>
  )
}
