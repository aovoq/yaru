import type { ComponentChildren } from "preact"
import { useEffect, useState } from "preact/hooks"
import { Button } from "../../components/button"

// 属性の値を見せておき、押すと入力に切り替える。入力を離れたら値の表示に戻る
// 表示中は入力がフォームに無いので、JavaScript なしの送信ではその属性を変えない
// 値の行は Button の inline (枠も余白も高さも持たない) で組み、ほかの属性の行 (高さ 28px) と高さをそろえる

export function EditableValue({
  empty,
  emptyText,
  display,
  link,
  input,
}: {
  empty: boolean
  emptyText: string
  display: ComponentChildren
  link?: string
  input: (onDone: () => void) => ComponentChildren
}) {
  const [editing, setEditing] = useState(false)
  // 切り替えた直後に入力へ focus を当てる。入力には data-editing を付けておく
  useEffect(() => {
    if (!editing) return
    document.querySelector<HTMLInputElement>("#issue-view input[data-editing]")?.focus()
  }, [editing])
  if (editing) {
    return <>{input(() => setEditing(false))}</>
  }
  return (
    <span class="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-[13px]">
      {empty ? (
        <Button variant="text" size="inline" onClick={() => setEditing(true)}>
          {emptyText}
        </Button>
      ) : (
        <>
          {link ? (
            <a href={link} class="min-w-0 truncate text-ink no-underline hover:underline">
              {display}
            </a>
          ) : (
            <Button
              variant="plain"
              size="inline"
              align="start"
              class="min-w-0 flex-1"
              onClick={() => setEditing(true)}
            >
              {display}
            </Button>
          )}
          {link ? (
            // sm (高さ 28px) だと値の行が高くなり、ほかの属性の行とそろわなくなるので、余白だけの xs にする
            <Button
              variant="ghost"
              size="xs"
              title="Change"
              class="ml-auto shrink-0"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          ) : null}
        </>
      )}
    </span>
  )
}
