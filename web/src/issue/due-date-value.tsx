import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "../components/button"
import { DueStamp } from "../components/due-stamp"
import { InlineInput } from "../components/inline-input"

// 属性欄の期日。ふだんは「Oct 20」か「Set due date」で見せ、押したときだけ日付の入力欄を出す
// 日付を選んだら保存し、離れたら字の表示に戻る。空にすると期日を外す

export function DueDateValue({
  dueDate,
  status,
  now,
  labelledBy,
  onCommit,
}: {
  dueDate: string | null
  status: string
  now: Date
  labelledBy: string
  onCommit: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const wrapper = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (editing) wrapper.current?.querySelector("input")?.focus()
  }, [editing])
  if (editing) {
    return (
      <span ref={wrapper} class="contents">
        <InlineInput
          type="date"
          name="dueDate"
          aria-labelledby={labelledBy}
          value={dueDate ?? ""}
          onChange={(event: Event) => onCommit((event.currentTarget as HTMLInputElement).value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== "Escape") return
            event.stopPropagation()
            setEditing(false)
          }}
        />
      </span>
    )
  }
  return (
    <Button
      id={`${labelledBy}-value`}
      aria-labelledby={`${labelledBy} ${labelledBy}-value`}
      variant="plain"
      size="inline"
      align="start"
      class="h-7 w-full min-w-0 px-2 text-body hover:bg-surface-2"
      onClick={() => setEditing(true)}
    >
      {dueDate ? (
        <DueStamp date={dueDate} status={status} now={now} />
      ) : (
        <span class="text-ink-tertiary">Set due date</span>
      )}
    </Button>
  )
}
