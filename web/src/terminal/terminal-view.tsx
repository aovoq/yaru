import { useEffect, useRef, useState } from "preact/hooks"
import type { JSX } from "preact"
import { Button } from "../components/button"
import { CopySheet } from "./copy-sheet"
import type { TerminalEngine } from "./terminal-engine"
import {
  FONT_LARGER_LABEL,
  FONT_SIZE_STORAGE_KEY,
  FONT_SMALLER_LABEL,
  TERMINAL_CONTENT_SECURITY_POLICY,
  TERMINAL_KEYS,
  type TerminalCopyClient,
  applyControl,
  encodeTerminalInput,
  loadFontSize,
  nextFontSize,
  resizePayload,
  terminalOutput,
  terminalWebSocketUrl,
  unavailableTerminalCopyClient,
} from "./terminal-logic"
import { type TerminalSocket, openBrowserSocket, socketIsOpen } from "./terminal-socket"
import { attachTerminalTouch } from "./terminal-touch"
import "./terminal.css"

// herdr の画面。接続ごとに /ws/terminal へ繋ぎ、切れたら再接続できる
// トークンは付けない。docs/spec/security.md の「WebSocket」
// ~/workspace/resident-app/web/src/Terminal.tsx

export const TERMINAL_STYLE_SRC = "unsafe-inline"

type TerminalStatus = "connecting" | "open" | "closed"

export function TerminalView({
  copyClient = unavailableTerminalCopyClient,
  openSocket = openBrowserSocket,
  engine,
  loadFont = loadTerminalFont,
  viewportWidth,
}: {
  copyClient?: TerminalCopyClient
  openSocket?: (url: string) => TerminalSocket
  engine?: TerminalEngine
  loadFont?: () => Promise<void>
  viewportWidth?: () => number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<TerminalEngine | null>(null)
  const socketRef = useRef<TerminalSocket | null>(null)
  const controlArmedRef = useRef(false)
  const fontSizeRef = useRef(initialFontSize())
  const [status, setStatus] = useState<TerminalStatus>("connecting")
  const [fontSize, setFontSize] = useState(fontSizeRef.current)
  const [controlArmed, setControlArmed] = useState(false)
  const [copying, setCopying] = useState(false)
  const [hint, setHint] = useState("")

  useEffect(() => {
    fontSizeRef.current = fontSize
  }, [fontSize])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let release = () => {}
    let hintTimer = 0

    void (async () => {
      await loadFont()
      if (disposed) return
      const provided = engine
      const active = provided ?? (await import("./terminal-engine")).createTerminalEngine(fontSizeRef.current)
      if (disposed) {
        if (!provided) active.dispose()
        return
      }
      engineRef.current = active
      active.onData((data) => {
        const result = applyControl(data, controlArmedRef.current)
        controlArmedRef.current = result.armed
        setControlArmed(result.armed)
        sendText(result.data)
      })
      active.onBinary((data) => {
        sendBytes(Uint8Array.from(data, (character) => character.charCodeAt(0)))
      })
      active.onResize(() => sendResize())
      active.open(host)
      try {
        active.attachWebGL()
      } catch {
        // WebGL が無いときは xterm の DOM 描画のままにする
      }
      active.fit()
      connect()
      const detachTouch = attachTerminalTouch(host, {
        viewportWidth: viewportWidth ?? (() => window.innerWidth),
        rowHeight: () => {
          const screen = host.querySelector(".xterm-screen")
          const rows = engineRef.current?.rows ?? 0
          if (!screen || rows <= 0) return 1
          return screen.clientHeight / rows
        },
        emitWheel: (lines, clientX, clientY) => {
          const target = engineRef.current?.element
          if (!target || lines === 0) return
          const height = host.querySelector(".xterm-screen")?.clientHeight ?? 0
          const rowHeight = (engineRef.current?.rows ?? 1) || 1
          const lineHeight = height / rowHeight
          for (let index = 0; index < Math.abs(lines); index += 1) {
            target.dispatchEvent(
              new WheelEvent("wheel", {
                deltaY: Math.sign(lines) * lineHeight,
                deltaMode: 0,
                clientX,
                clientY,
                bubbles: true,
                cancelable: true,
              }),
            )
          }
        },
        sendSequence: sendText,
        showHint: (next) => {
          setHint(next)
          window.clearTimeout(hintTimer)
          hintTimer = window.setTimeout(() => setHint(""), 600)
        },
      })
      const Observer = window.ResizeObserver
      const observer = Observer ? new Observer(() => active.fit()) : null
      observer?.observe(host)
      release = () => {
        window.clearTimeout(hintTimer)
        observer?.disconnect()
        detachTouch()
        socketRef.current?.close()
        socketRef.current = null
        active.dispose()
        if (engineRef.current === active) engineRef.current = null
      }
    })()

    return () => {
      disposed = true
      release()
    }
    // 接続はマウントのあいだ 1 本。キーとソケットは ref で今の値を見る
  }, [])

  function connect(): void {
    const active = engineRef.current
    if (!active) return
    const previous = socketRef.current
    socketRef.current = null
    previous?.close()
    setStatus("connecting")
    const url = terminalWebSocketUrl(window.location.href, active.cols, active.rows)
    const socket = openSocket(url)
    socket.binaryType = "arraybuffer"
    socket.onopen = () => {
      setStatus("open")
      active.reset()
      active.focus()
    }
    socket.onmessage = (event) => {
      active.write(terminalOutput(event.data))
    }
    socket.onclose = () => {
      if (socketRef.current === socket) setStatus("closed")
    }
    socketRef.current = socket
  }

  function sendText(text: string): void {
    if (!socketIsOpen(socketRef.current)) return
    socketRef.current?.send(encodeTerminalInput(text))
  }

  function sendBytes(bytes: Uint8Array): void {
    if (!socketIsOpen(socketRef.current)) return
    socketRef.current?.send(bytes)
  }

  function sendResize(): void {
    const active = engineRef.current
    if (!active || !socketIsOpen(socketRef.current)) return
    socketRef.current?.send(resizePayload(active.cols, active.rows))
  }

  function changeFont(delta: number): void {
    const next = nextFontSize(fontSizeRef.current, delta)
    fontSizeRef.current = next
    setFontSize(next)
    try {
      window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(next))
    } catch {
      // 保存できないときはこの画面のあいだだけ大きさを変える
    }
    engineRef.current?.setFontSize(next)
  }

  function keepKeyboard(event: JSX.TargetedPointerEvent<HTMLButtonElement>): void {
    event.preventDefault()
  }

  return (
    <main
      data-screen="terminal"
      data-csp-style={TERMINAL_STYLE_SRC}
      data-csp={TERMINAL_CONTENT_SECURITY_POLICY}
      data-status={status}
      class="flex h-full min-h-0 flex-col bg-[#0f1115] text-[#d8dde6]"
    >
      <div class="relative min-h-0 flex-1 pt-[calc(env(safe-area-inset-top)+4px)] pr-1 pl-1">
        <div ref={hostRef} class="h-full w-full" />
        {hint !== "" ? (
          <div class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/80 px-4 py-2.5 text-prose text-white">
            {hint}
          </div>
        ) : null}
        {status !== "open" ? (
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0f1115]/80">
            {status === "closed" ? (
              <>
                <span>切断されました</span>
                <Button variant="primary" size="md" onClick={() => connect()}>
                  再接続
                </Button>
              </>
            ) : (
              <span>接続中…</span>
            )}
          </div>
        ) : null}
      </div>
      <div class="flex items-center gap-1.5 overflow-x-auto border-t border-hairline bg-surface-2 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
        {TERMINAL_KEYS.map((key) => (
          <Button
            key={key.label}
            size="md"
            variant={key.control && controlArmed ? "primary" : "secondary"}
            aria-pressed={key.control ? controlArmed : undefined}
            class="shrink-0 font-mono"
            onPointerDown={keepKeyboard}
            onClick={() => {
              if (key.control) {
                const next = !controlArmedRef.current
                controlArmedRef.current = next
                setControlArmed(next)
                return
              }
              sendText(key.sequence ?? "")
            }}
          >
            {key.label}
          </Button>
        ))}
        <span class="mx-0.5 h-6 w-px shrink-0 bg-hairline" />
        <Button
          size="md"
          variant="secondary"
          class="shrink-0 font-mono"
          onPointerDown={keepKeyboard}
          onClick={() => changeFont(-1)}
        >
          {FONT_SMALLER_LABEL}
        </Button>
        <span data-font-size={fontSize} class="min-w-5 shrink-0 text-center font-mono text-small text-ink-subtle">
          {fontSize}
        </span>
        <Button
          size="md"
          variant="secondary"
          class="shrink-0 font-mono"
          onPointerDown={keepKeyboard}
          onClick={() => changeFont(1)}
        >
          {FONT_LARGER_LABEL}
        </Button>
        <Button
          size="md"
          variant="secondary"
          class="shrink-0"
          onClick={() => {
            engineRef.current?.blur()
            setCopying(true)
          }}
        >
          コピー
        </Button>
        <a
          href="/"
          class="inline-flex h-11 shrink-0 items-center rounded-md border border-hairline px-3 text-prose text-ink-muted no-underline sm:h-9"
        >
          一覧
        </a>
      </div>
      {copying ? (
        <CopySheet
          client={copyClient}
          onClose={() => {
            setCopying(false)
            engineRef.current?.focus()
          }}
        />
      ) : null}
    </main>
  )
}

function initialFontSize(): number {
  let stored: string | null = null
  let narrow = false
  try {
    stored = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY)
    narrow = window.matchMedia("(max-width: 600px)").matches
  } catch {
    stored = null
  }
  return loadFontSize(stored, narrow)
}

export function loadTerminalFont(): Promise<void> {
  const fonts = document.fonts
  const loading = fonts
    ? Promise.all(["400", "700"].map((weight) => fonts.load(`${weight} 16px "Ioskeley Mono Web"`)))
    : Promise.resolve([])
  return Promise.race([
    loading.then(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 3000)
    }),
  ]).then(
    () => undefined,
    () => undefined,
  )
}
