import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "../components/button"
import { copyText } from "./copy-text"
import {
  type TerminalCopyClient,
  type TerminalPane,
  cleanPaneText,
  initialPaneId,
  orderPanes,
} from "./terminal-logic"

// pane の出力をテキストで出し、範囲選択でもコピーできるようにする
// ~/workspace/resident-app/web/src/CopySheet.tsx

const COPY_TOAST_MS = 2000
const READ_LINES = 500

export function CopySheet({
  client,
  onClose,
  copy = copyText,
}: {
  client: TerminalCopyClient
  onClose: () => void
  copy?: (text: string) => Promise<boolean>
}) {
  const [panes, setPanes] = useState<TerminalPane[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [textError, setTextError] = useState<string | null>(null)
  const [textLoading, setTextLoading] = useState(false)
  const [toast, setToast] = useState("")
  const bodyRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let cancelled = false
    void client.listPanes().then(
      (listed) => {
        if (cancelled) return
        const ordered = orderPanes(listed)
        setPanes(ordered)
        setSelectedId((current) => current ?? initialPaneId(ordered))
      },
      (error: unknown) => {
        if (cancelled) return
        setPanes([])
        setLoadError(errorText(error))
      },
    )
    return () => {
      cancelled = true
    }
  }, [client])

  useEffect(() => {
    if (selectedId === null) return
    let cancelled = false
    setTextLoading(true)
    setTextError(null)
    void client.readPane(selectedId).then(
      (body) => {
        if (cancelled) return
        setText(cleanPaneText(body))
        setTextLoading(false)
      },
      (error: unknown) => {
        if (cancelled) return
        setText(null)
        setTextError(errorText(error))
        setTextLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [client, selectedId])

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    queueMicrotask(() => {
      body.scrollTop = body.scrollHeight
    })
  }, [text])

  useEffect(() => {
    if (toast === "") return
    const timer = window.setTimeout(() => setToast(""), COPY_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function copyAll(): Promise<void> {
    const copied = await copy(text ?? "")
    setToast(copied ? "コピーしました" : "コピーできませんでした。長押しで選択してください")
  }

  return (
    <div
      class="fixed inset-0 z-10 flex items-end bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        data-sheet="copy"
        class="flex h-[85dvh] w-full flex-col overflow-hidden rounded-t-xl bg-surface-2 text-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="flex items-center gap-2 border-b border-hairline px-3 pt-3 pb-2">
          <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {(panes ?? []).map((pane) => (
              <Button
                key={pane.paneId}
                size="sm"
                variant={selectedId === pane.paneId ? "primary" : "secondary"}
                aria-pressed={selectedId === pane.paneId}
                class="max-w-[60vw] shrink-0 truncate"
                onClick={() => setSelectedId(pane.paneId)}
              >
                {pane.label}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" aria-label="閉じる" onClick={onClose}>
            ×
          </Button>
        </header>
        <pre
          ref={bodyRef}
          class="terminal-copy m-0 min-h-0 flex-1 overflow-auto bg-[#0f1115] p-3 text-small wrap-break-word whitespace-pre-wrap text-[#d8dde6]"
        >
          {sheetBody(loadError, panes, textLoading, textError, text)}
        </pre>
        <footer class="flex items-center justify-between gap-3 border-t border-hairline px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+10px)]">
          <span class="text-small text-ink-subtle">
            {toast || "長押しで範囲を選んでコピー"}
          </span>
          <Button variant="primary" size="md" disabled={!text} onClick={() => void copyAll()}>
            全部コピー
          </Button>
        </footer>
      </section>
    </div>
  )
}

function sheetBody(
  loadError: string | null,
  panes: TerminalPane[] | null,
  textLoading: boolean,
  textError: string | null,
  text: string | null,
): string {
  if (loadError) return loadError
  if (panes === null || textLoading) return "読み込み中…"
  if (textError) return textError
  return text ?? ""
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message
  return String(error)
}
