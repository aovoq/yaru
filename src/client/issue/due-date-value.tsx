import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "../../components/button"
import { DueStamp } from "../../components/due-stamp"
import { InlineInput } from "../../components/inline-input"

// 属性欄の期日。ふだんは一覧と同じ「Oct 20」の字 (DueStamp) か「Set due date」で見せ、押したときだけ日付の入力欄を出す
// 日付の入力欄は常に出しておくとブラウザの形 (2026/10/24 と暦のアイコン) が他の属性の値と並ばず、目を引いてしまうため
// 入力欄で日付を選んだら (change) 保存し、離れたら字の表示に戻る。空にすると期日を外す

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
  // InlineInput は関数の部品で ref を受け取らないので、包む枠から入力欄を探して focus を当てる
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
            // Esc は issue を閉じずに、期日の編集だけを終える
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
