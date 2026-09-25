import type { ComponentChildren } from "preact"
import { useCallback, useState } from "preact/hooks"
import { Combobox, type ComboboxOption } from "../../components/combobox"
import { Popover, type PopoverAlign } from "../../components/popover"

// issue 画面で属性の値を選ぶ部品。押すと trigger のすぐ下に候補の面 (Popover) を開き、打って絞り込んで選ぶ (Combobox)
// 状態・優先度・担当者・ラベル・親・止めている issue・止められている issue で共通に使う
// 開いているかどうかはここで持つ。trigger は呼ぶ側が描き、渡した属性 (押したときの処理と開閉の状態) を付ける
// 1 つだけ選ぶ属性は選んだら閉じ、複数選ぶ属性は開いたまま付け外しを続けられる (Combobox の multiple)

export type PickerTriggerProps = {
  onClick: () => void
  "aria-expanded": "true" | "false"
  "aria-haspopup": "listbox"
}

export function PropertyPicker({
  label,
  trigger,
  options,
  selected,
  multiple = false,
  placeholder,
  emptyText,
  align = "start",
  onSelect,
  onCreate,
  createLabel,
  header,
}: {
  // 検索欄と候補の一覧の読み上げの名前
  label: string
  trigger: (props: PickerTriggerProps) => ComponentChildren
  options: ComboboxOption[]
  selected: string[]
  multiple?: boolean
  placeholder?: string
  emptyText?: string
  align?: PopoverAlign
  onSelect: (value: string) => void
  onCreate?: (query: string) => void
  createLabel?: (query: string) => string
  // 検索欄の上に置く切り替え (関係の種類を選ぶボタンなど)
  header?: ComponentChildren
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <Popover
      open={open}
      onClose={close}
      align={align}
      trigger={trigger({
        onClick: () => setOpen((current) => !current),
        "aria-expanded": open ? "true" : "false",
        "aria-haspopup": "listbox",
      })}
    >
      {header}
      {/* 関係の種類のように同じ面の中で選ぶものが変わったら、打った言葉と選んでいる候補を作り直す */}
      <Combobox
        key={label}
        label={label}
        options={options}
        selected={selected}
        multiple={multiple}
        placeholder={placeholder}
        emptyText={emptyText}
        onSelect={onSelect}
        onCreate={onCreate}
        createLabel={createLabel}
        onClose={close}
      />
    </Popover>
  )
}
