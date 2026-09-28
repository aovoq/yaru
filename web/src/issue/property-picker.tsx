import type { ComponentChildren } from "preact"
import { useCallback, useState } from "preact/hooks"
import { Combobox, type ComboboxOption } from "../components/combobox"
import { Popover, type PopoverAlign } from "../components/popover"

// 属性の値を選ぶ部品。押すと候補の面を開き、打って絞り込んで選ぶ
// https://www.w3.org/WAI/ARIA/apg/patterns/combobox/

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
