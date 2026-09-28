import type { ComponentChildren } from "preact"
import { useEffect, useId, useRef, useState } from "preact/hooks"
import { CheckIcon } from "./icons/check-icon"
import { PlusIcon } from "./icons/plus-icon"

// 検索欄と候補の一覧を組にした選択の部品。状態・優先度・担当者・ラベル・親・関係の選択で共通に使う
// 打つと候補を絞り込み、↑↓ で選ぶ候補を動かし、Enter で選び、Esc で閉じる。focus は検索欄に置いたまま、
// 選んでいる候補は aria-activedescendant で読み上げに伝える (APG の combobox の型)
// https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
// 1 つだけ選ぶとき (multiple が無いとき) は選んだら onClose を呼んで閉じる。複数選ぶときは開いたまま onSelect で付け外しを伝える
// onCreate を渡すと、打った言葉に合う候補が無いときに「Create "…"」を一覧の最後に出す
// 見た目は右クリックのメニュー (client/context-menu) の面と行にそろえる。Popover の中に置くと同じ面の上に並ぶ

export type ComboboxOption = {
  value: string
  label: string
  // 行の左に置くアイコン (状態・優先度・担当者の頭文字・ラベルの色など)
  icon?: ComponentChildren
  // label に無い言葉でも引けるようにする別名。「doing」で In Progress を引くなど
  keywords?: string[]
}

type Item = { kind: "option"; option: ComboboxOption } | { kind: "create"; query: string }

export function Combobox({
  label,
  options,
  selected,
  multiple = false,
  placeholder = "Search…",
  emptyText = "No results",
  onSelect,
  onCreate,
  createLabel = (query) => `Create "${query}"`,
  onClose,
}: {
  // 検索欄の読み上げの名前 (「Status」「Labels」など)
  label: string
  options: ComboboxOption[]
  selected: string[]
  multiple?: boolean
  placeholder?: string
  emptyText?: string
  onSelect: (value: string) => void
  onCreate?: (query: string) => void
  createLabel?: (query: string) => string
  onClose?: () => void
}) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState("")
  const items = comboboxItems(options, query, onCreate !== undefined)
  // 開いたときは選ばれている候補から始める。今の値の近くから動かすことが多いため
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      items.findIndex((item) => item.kind === "option" && selected.includes(item.option.value)),
    ),
  )
  const active = items[Math.min(activeIndex, items.length - 1)]
  const optionId = (index: number) => `${id}-option-${index}`

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // キーボードで動かした候補が一覧の外に出たら、見える位置まで送る
  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>("[data-active]")
    element?.scrollIntoView?.({ block: "nearest" })
  }, [activeIndex, query])

  const choose = (item: Item | undefined) => {
    if (!item) return
    if (item.kind === "create") {
      onCreate?.(item.query)
      setQuery("")
      setActiveIndex(0)
      if (!multiple) onClose?.()
      return
    }
    onSelect(item.option.value)
    if (!multiple) onClose?.()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // 日本語の変換を確定する Enter や矢印では選ばない。keyCode 229 は変換中を isComposing で伝えない古い Safari のため
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      event.stopPropagation()
      if (items.length === 0) return
      const step = event.key === "ArrowDown" ? 1 : -1
      const current = Math.min(activeIndex, items.length - 1)
      setActiveIndex((current + step + items.length) % items.length)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      event.stopPropagation()
      choose(active)
      return
    }
    if (event.key === "Escape" && onClose) {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <div class="flex w-full min-w-52 flex-col">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active ? optionId(items.indexOf(active)) : undefined}
        autocomplete="off"
        spellcheck={false}
        placeholder={placeholder}
        value={query}
        onInput={(event) => {
          setQuery(event.currentTarget.value)
          setActiveIndex(0)
        }}
        onKeyDown={onKeyDown}
        // スマホは 16px 未満の欄に focus すると画面を拡大してしまうので、狭い幅では大きめの字にする
        class="mb-1 h-8 w-full border-0 border-b border-hairline bg-transparent px-2 font-sans text-base text-ink outline-none placeholder:text-ink-tertiary sm:text-body"
      />
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple ? "true" : undefined}
        class="flex max-h-64 flex-col overflow-y-auto"
      >
        {items.length === 0 ? (
          <div class="text-body px-2 py-1.5 text-ink-tertiary">{emptyText}</div>
        ) : (
          items.map((item, index) => {
            const isSelected = item.kind === "option" && selected.includes(item.option.value)
            return (
              <div
                key={item.kind === "option" ? `option-${item.option.value}` : "create"}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected ? "true" : "false"}
                data-active={item === active ? "" : undefined}
                // 押しても検索欄から focus を離さない。離れると ↑↓ と Enter が効かなくなるため
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => {
                  if (index !== activeIndex) setActiveIndex(index)
                }}
                onClick={() => choose(item)}
                class="text-body flex h-8 w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2 text-ink-muted data-active:bg-hairline-strong data-active:text-ink"
              >
                <span class="grid w-4 shrink-0 place-items-center">
                  {item.kind === "create" ? <PlusIcon /> : item.option.icon}
                </span>
                <span class="min-w-0 flex-1 truncate">
                  {item.kind === "create" ? createLabel(item.query) : item.option.label}
                </span>
                {isSelected ? <CheckIcon /> : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// 打った言葉で候補を絞り、作れるなら「作る」候補を最後に足す
// 大文字小文字を区別せず、label・value・keywords のどれかに含まれていれば残す
function comboboxItems(options: ComboboxOption[], query: string, creatable: boolean): Item[] {
  const needle = query.trim().toLowerCase()
  const matches = options.filter(
    (option) =>
      !needle ||
      [option.label, option.value, ...(option.keywords ?? [])].some((text) =>
        text.toLowerCase().includes(needle),
      ),
  )
  const items: Item[] = matches.map((option) => ({ kind: "option", option }))
  const exists = options.some(
    (option) => option.label.toLowerCase() === needle || option.value.toLowerCase() === needle,
  )
  if (creatable && needle && !exists) items.push({ kind: "create", query: query.trim() })
  return items
}
