import { useCallback, useEffect, useState } from "preact/hooks"
import { AutoGrowTextarea } from "../../components/auto-grow-textarea"
import { Button } from "../../components/button"
import { FOCUS_RING } from "../../components/focus-ring"
import { Markdown } from "../../components/markdown"
import { textareaClass } from "../../components/textarea"
import { toggleTask } from "../../markdown"
import type { Issue } from "../../store"

// issue の説明。描画した Markdown を見せ、押すと生の Markdown の編集に切り替える
// チェックボックスはその場で [ ] と [x] を切り替える
export function Description({
  issue,
  startEditing,
  onChangeBody,
  onCommitBody,
}: {
  issue: Issue
  startEditing: boolean
  onChangeBody: (body: string) => void
  onCommitBody: (body: string) => void
}) {
  const [editing, setEditing] = useState(startEditing)
  useEffect(() => {
    if (!editing) return
    document.querySelector<HTMLTextAreaElement>("#issue-description-editor")?.focus()
  }, [editing])
  const onPreviewClick = useCallback(
    (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target instanceof HTMLInputElement && target.dataset.taskIndex !== undefined) {
        event.preventDefault()
        onCommitBody(toggleTask(issue.body, Number(target.dataset.taskIndex)))
        return
      }
      if (target.closest("a")) return
      setEditing(true)
    },
    [issue.body, onCommitBody],
  )
  if (editing) {
    return (
      <div class="flex flex-col gap-1.5">
        <AutoGrowTextarea
          id="issue-description-editor"
          name="body"
          value={issue.body}
          onInput={(event: Event) =>
            onChangeBody((event.currentTarget as HTMLTextAreaElement).value)
          }
          onBlur={(event: Event) => {
            if (!startEditing) onCommitBody((event.currentTarget as HTMLTextAreaElement).value)
          }}
          onKeyDown={(event: KeyboardEvent) => {
            // Esc は issue を閉じずに、説明の編集だけを終える。離れたときと同じく保存する
            if (event.key !== "Escape") return
            event.stopPropagation()
            if (!startEditing) onCommitBody((event.currentTarget as HTMLTextAreaElement).value)
            setEditing(false)
          }}
          placeholder="Add description… (Markdown)"
          class={textareaClass({ mono: true }, "min-h-40 resize-none overflow-hidden")}
        />
        {startEditing ? null : (
          <div class="flex items-center gap-2 text-[11px] text-ink-tertiary">
            <span>Markdown</span>
            <Button variant="ghost" class="ml-auto" onClick={() => setEditing(false)}>
              Preview (Esc)
            </Button>
          </div>
        )}
      </div>
    )
  }
  if (!issue.body.trim()) {
    // Button は中身を真ん中に寄せ、字も 13px にするので、中身を包む span で行の幅を埋めて左に寄せ、説明の本文と同じ 14px にする
    // 押すと文を書き始める場所なので、指の形ではなく文字の入力の形のカーソルを span で出す
    return (
      <Button variant="text" size="inline" class="w-full" onClick={() => setEditing(true)}>
        <span class="flex-1 cursor-text py-1 text-left text-[14px]">Add description…</span>
      </Button>
    )
  }
  return (
    <Markdown
      id="issue-description-preview"
      source={issue.body}
      role="button"
      tabindex={0}
      title="Click to edit"
      onClick={onPreviewClick}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter" && event.target === event.currentTarget) setEditing(true)
      }}
      class={`-mx-2 cursor-text rounded-md px-2 py-1 transition-colors hover:bg-surface-1 ${FOCUS_RING}`}
    />
  )
}
