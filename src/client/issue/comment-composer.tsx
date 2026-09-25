import { Button } from "../../components/button"
import { Textarea } from "../../components/textarea"

// issue 画面の活動欄の下に置くコメントの入力欄と送信のボタン
// issue を保存するフォームの中に置かれるので、フォームを入れ子にせず、form 属性で外に置いた #comment-form へ送る
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form

export function CommentComposer() {
  return (
    <div class="flex flex-col gap-2">
      <Textarea
        form="comment-form"
        name="body"
        placeholder="Leave a comment…"
        class="min-h-20 resize-y"
      />
      <div class="flex justify-end">
        <Button type="submit" form="comment-form">
          Comment
        </Button>
      </div>
    </div>
  )
}
