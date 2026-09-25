import { useCallback, useEffect, useState } from "preact/hooks"
import { Button } from "../../components/button"
import { renderMarkdown, toggleTask } from "../../markdown"
import type { Issue } from "../../store"
import { AutoGrowTextarea } from "./fields"

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
          class="min-h-40 w-full resize-none overflow-hidden rounded-md border border-hairline bg-surface-1 p-3 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-tertiary focus:border-hairline-strong focus:outline-none"
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
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        class="w-full cursor-text rounded-md border-0 bg-transparent px-0 py-1 text-left font-sans text-[14px] text-ink-tertiary hover:text-ink-subtle"
      >
        Add description…
      </button>
    )
  }
  // 押して編集に切り替えるため、Markdown 部品ではなく id と操作を持たせた要素に直接描く
  return (
    <div
      id="issue-description-preview"
      role="button"
      tabindex={0}
      title="Click to edit"
      onClick={onPreviewClick}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter" && event.target === event.currentTarget) setEditing(true)
      }}
      class="markdown -mx-2 cursor-text rounded-md px-2 py-1 transition-colors hover:bg-surface-1 focus-visible:outline-2 focus-visible:outline-primary-focus/50"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(issue.body) }}
    />
  )
}
