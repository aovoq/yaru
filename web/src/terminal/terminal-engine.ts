import { FitAddon } from "@xterm/addon-fit"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { TERMINAL_FONT_FAMILY } from "./terminal-logic"

// xterm.js 6 は描画時に style 要素を足す。このファイルを開く文書だけ style-src に unsafe-inline が要る
// docs/spec/security.md の「決定 (2026-09-28)」
// ~/workspace/resident-app/web/src/Terminal.tsx:55-65, 233-240

export type TerminalEngine = {
  cols: number
  rows: number
  element: HTMLElement | null
  open: (host: HTMLElement) => void
  dispose: () => void
  write: (data: string | Uint8Array) => void
  reset: () => void
  focus: () => void
  blur: () => void
  fit: () => void
  setFontSize: (size: number) => void
  onData: (handler: (data: string) => void) => void
  onBinary: (handler: (data: string) => void) => void
  onResize: (handler: () => void) => void
  attachWebGL: () => void
}

export function createTerminalEngine(fontSize: number): TerminalEngine {
  const terminal = new Terminal({
    fontSize,
    fontFamily: TERMINAL_FONT_FAMILY,
    cursorBlink: true,
    allowProposedApi: true,
    theme: { background: "#0f1115" },
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = "11"
  return {
    get cols() {
      return terminal.cols
    },
    get rows() {
      return terminal.rows
    },
    get element() {
      return terminal.element ?? null
    },
    open(host) {
      terminal.open(host)
    },
    dispose() {
      terminal.dispose()
    },
    write(data) {
      terminal.write(data)
    },
    reset() {
      terminal.reset()
    },
    focus() {
      terminal.focus()
    },
    blur() {
      terminal.blur()
    },
    fit() {
      fit.fit()
    },
    setFontSize(size) {
      terminal.options.fontSize = size
      fit.fit()
    },
    onData(handler) {
      terminal.onData(handler)
    },
    onBinary(handler) {
      terminal.onBinary(handler)
    },
    onResize(handler) {
      terminal.onResize(handler)
    },
    attachWebGL() {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      terminal.loadAddon(webgl)
    },
  }
}
