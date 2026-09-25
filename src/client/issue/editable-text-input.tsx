import { InlineInput } from "../../components/inline-input"

// EditableValue を押したあとに出す 1 行の入力欄。ラベル・親・止めている issue で使う
// 離れたときにその項目を保存し、値の表示に戻す。Enter では InlineInput の既定の blurOnEnter で離れる (IME の変換の確定では離れない)
// EditableValue が切り替えた直後にこの欄へ focus を当てられるよう、data-editing を付けておく

export function EditableTextInput({
  name,
  value,
  placeholder,
  onInput,
  onCommit,
  onDone,
}: {
  name: string
  value: string
  placeholder: string
  onInput: (event: Event) => void
  onCommit: (event: Event) => void
  onDone: () => void
}) {
  return (
    <InlineInput
      data-editing=""
      name={name}
      value={value}
      onInput={onInput}
      onBlur={(event: Event) => {
        onCommit(event)
        onDone()
      }}
      placeholder={placeholder}
    />
  )
}
