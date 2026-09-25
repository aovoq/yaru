import type { ComponentChildren } from "preact"
import { useEffect, useState } from "preact/hooks"
import { Button } from "../../components/button"

// 属性の値を見せておき、押すと入力に切り替える。入力を離れたら値の表示に戻る
// 表示中は入力がフォームに無いので、JavaScript なしの送信ではその属性を変えない
// 値の行は Button の text と inline (枠も余白も高さも持たない) で組み、ほかの属性の行 (高さ 28px) と高さをそろえる

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
            // Button は中身を真ん中に寄せるので、中身を包む span で行の幅を埋めて左に寄せる
            // 文字の色も Button の text (薄い色) ではなく値の色にしたいので、この span で決める
            <Button
              variant="text"
              size="inline"
              class="min-w-0 flex-1"
              onClick={() => setEditing(true)}
            >
              <span class="min-w-0 flex-1 text-left text-ink">{display}</span>
            </Button>
          )}
          {link ? (
            // Button の sm (高さ 28px) を置くと値の行が上下の余白の分だけ高くなり、ほかの属性の行とそろわなくなるので、inline にする
            // 字の大きさと hover の面は inline の 13px と違うので、中身の span で決める
            <Button
              variant="text"
              size="inline"
              title="Change"
              class="ml-auto shrink-0"
              onClick={() => setEditing(true)}
            >
              <span class="rounded px-1 text-[11px] hover:bg-surface-2 hover:text-ink">Edit</span>
            </Button>
          ) : null}
        </>
      )}
    </span>
  )
}
