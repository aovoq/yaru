import { Fragment } from "preact"
import { useEffect, useId, useRef, useState } from "preact/hooks"
import { Dialog } from "../../components/dialog"
import { useBoardApi } from "../board-api"
import {
  paletteEntries,
  type PaletteCommand,
  type PaletteInput,
  type PaletteWorkspace,
} from "./palette-entries"
import { PaletteRow } from "./palette-row"

// ⌘K で開くコマンドパレット。1 つの検索欄から issue・答えを待っている質問・ワークスペース・選んでいる issue の操作を引く
// 打つと候補を絞り、↑↓ で選び、Enter で実行し、Esc で閉じる。focus は検索欄に置いたまま、選んでいる候補は aria-activedescendant で伝える
// https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
// ワークスペースの一覧は GetInbox から開いたときに読む。読めなければ出さない (docs/spec/routes.md の GetInbox)

export function CommandPalette({
  input,
  onRun,
  onClose,
}: {
  input: Omit<PaletteInput, "query" | "workspaces">
  onRun: (command: PaletteCommand) => void
  onClose: () => void
}) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [workspaces, setWorkspaces] = useState<PaletteWorkspace[]>([])
  const api = useBoardApi()
  const entries = paletteEntries({ ...input, query, workspaces })
  const active = entries[Math.min(activeIndex, entries.length - 1)]
  const optionId = (index: number) => `${id}-option-${index}`

  // autofocus は後から差し込んだ要素では効かないので、描いたあとに検索欄へ focus を置く
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    void api.loadWorkspaces().then(
      (loaded) => {
        if (!cancelled) setWorkspaces(loaded)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [api])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView?.({
      block: "nearest",
    })
  }, [activeIndex, query])

  const run = (index: number) => {
    const entry = entries[index]
    if (!entry) return
    onClose()
    onRun(entry.command)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // 日本語の変換を確定する Enter や矢印では選ばない。keyCode 229 は変換中を isComposing で伝えない古い Safari のため
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (entries.length === 0) return
      const step = event.key === "ArrowDown" ? 1 : -1
      const current = Math.min(activeIndex, entries.length - 1)
      setActiveIndex((current + step + entries.length) % entries.length)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      run(Math.min(activeIndex, entries.length - 1))
    }
  }

  // 同じまとまりの候補が続く間は見出しを 1 度だけ出す
  let previousGroup: string | null = null
  return (
    <Dialog
      label="Command palette"
      placement="top"
      onClose={onClose}
      class="max-w-xl overflow-hidden"
    >
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search issues and commands"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active ? optionId(entries.indexOf(active)) : undefined}
        autocomplete="off"
        spellcheck={false}
        placeholder="Search issues, questions, or commands…"
        value={query}
        onInput={(event) => {
          setQuery(event.currentTarget.value)
          setActiveIndex(0)
        }}
        onKeyDown={onKeyDown}
        // スマホは 16px 未満の欄に focus すると画面を拡大してしまうので、狭い幅では大きめの字にする
        class="h-12 w-full border-0 border-b border-hairline bg-transparent px-4 font-sans text-base text-ink outline-none placeholder:text-ink-tertiary sm:text-title"
      />
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Results"
        class="flex max-h-[60vh] flex-col overflow-y-auto p-1"
      >
        {entries.length === 0 ? (
          <div class="text-body px-3 py-2 text-ink-tertiary">No results</div>
        ) : (
          entries.map((entry, index) => {
            const heading = entry.group !== previousGroup ? entry.group : null
            previousGroup = entry.group
            return (
              <Fragment key={entry.key}>
                {heading ? (
                  <div
                    role="presentation"
                    class="text-micro px-3 pt-2 pb-1 font-medium text-ink-tertiary"
                  >
                    {heading}
                  </div>
                ) : null}
                <PaletteRow
                  entry={entry}
                  id={optionId(index)}
                  active={entry === active}
                  onPointerMove={() => {
                    if (index !== activeIndex) setActiveIndex(index)
                  }}
                  onChoose={() => run(index)}
                />
              </Fragment>
            )
          })
        )}
      </div>
    </Dialog>
  )
}
