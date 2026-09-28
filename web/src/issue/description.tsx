import { useEffect, useRef, useState } from "preact/hooks"
import { AutoGrowTextarea } from "../components/auto-grow-textarea"
import { Button } from "../components/button"
import { Markdown } from "../components/markdown"
import { textareaClass } from "../components/textarea"
import { toggleTask } from "../markdown"
import type { Issue } from "../domain/issue"

// issue の説明。描いた Markdown を見せ、Edit で生の Markdown に切り替える
// マウスで操作する画面では本文を押しても編集に移る。指の画面では移らない
// https://drafts.csswg.org/mediaqueries-4/#pointer
// チェックボックスはどちらの画面でもその場で [ ] と [x] を切り替える

const FINE_POINTER = "(hover: hover) and (pointer: fine)"

export function Description({
  issue,
  isNew,
  issueHref,
  onChangeBody,
  onCommitBody,
}: {
  issue: Issue
  isNew: boolean
  issueHref: (id: string) => string
  onChangeBody: (body: string) => void
  onCommitBody: (body: string) => void
}) {
  const [editing, setEditing] = useState(isNew)
  const focusRequested = useRef(false)
  useEffect(() => {
    if (!editing || !focusRequested.current) return
    focusRequested.current = false
    document.querySelector<HTMLTextAreaElement>("#issue-description-editor")?.focus()
  }, [editing])
  const startEditing = () => {
    focusRequested.current = true
    setEditing(true)
  }

  const onPreviewClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target instanceof HTMLInputElement && target.dataset.taskIndex !== undefined) {
      event.preventDefault()
      onCommitBody(toggleTask(issue.body, Number(target.dataset.taskIndex)))
      return
    }
    if (target.closest("a")) return
    if (!window.matchMedia(FINE_POINTER).matches) return
    if (window.getSelection?.()?.toString()) return
    startEditing()
  }

  if (editing) {
    const finish = (event: Event) => {
      onCommitBody((event.currentTarget as HTMLTextAreaElement).value)
    }
    return (
      <div class="flex flex-col gap-1.5">
        <AutoGrowTextarea
          id="issue-description-editor"
          name="body"
          aria-label="Description"
          value={issue.body}
          onInput={(event: Event) =>
            onChangeBody((event.currentTarget as HTMLTextAreaElement).value)
          }
          onBlur={finish}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== "Escape") return
            event.stopPropagation()
            finish(event)
            setEditing(false)
          }}
          placeholder="Add description… (Markdown)"
          class={textareaClass({ prose: true }, "min-h-40 resize-none overflow-hidden")}
        />
        <div class="flex items-center gap-2 text-micro text-ink-tertiary">
          <span>Markdown</span>
          <Button variant="ghost" size="xs" class="ml-auto" onClick={() => setEditing(false)}>
            Preview
            <span class="hidden sm:inline">(Esc)</span>
          </Button>
        </div>
      </div>
    )
  }
  if (!issue.body.trim()) {
    return (
      <Button
        variant="text"
        size="inline"
        align="start"
        cursor="text"
        class="w-full py-1 text-prose"
        onClick={startEditing}
      >
        Add description…
      </Button>
    )
  }
  return (
    <div class="group flex flex-col gap-1">
      <Markdown
        id="issue-description-preview"
        source={issue.body}
        issueHref={issueHref}
        onClick={onPreviewClick}
        class="-mx-2 rounded-md px-2 py-1 transition-colors pointer-fine:cursor-text pointer-fine:hover:bg-surface-1"
      />
      <div class="flex justify-end">
        <Button
          variant="ghost"
          size="xs"
          aria-label="Edit description"
          class="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
          onClick={startEditing}
        >
          Edit
        </Button>
      </div>
    </div>
  )
}
