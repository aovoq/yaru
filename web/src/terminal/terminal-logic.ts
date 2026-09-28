// 端末の経路、キー、スワイプ、文字サイズ。描画と xterm は持たない
// 元は ~/workspace/resident-app/web/src/Terminal.tsx と CopySheet.tsx
// 端末の文書だけ style-src を緩める。docs/spec/security.md の「決定 (2026-09-28)」
// https://www.rfc-editor.org/rfc/rfc6455

export const TERMINAL_DOCUMENT_PATH = "/terminal"
export const TERMINAL_SOCKET_PATH = "/ws/terminal"

export const DOCUMENT_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' http: https:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

// style-src だけ足す。style-src-attr の unsafe-inline とは別で、script-src には足さない
export const TERMINAL_CONTENT_SECURITY_POLICY = DOCUMENT_CONTENT_SECURITY_POLICY.replace(
  "style-src 'self';",
  "style-src 'self' 'unsafe-inline';",
)

export const FONT_SIZE_STORAGE_KEY = "terminalFontSize"
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 24
export const SWIPE_EDGE_PX = 24
export const SWIPE_MIN_X_PX = 60
export const SWIPE_MAX_MS = 600
export const INERTIA_START = 0.3
export const INERTIA_STOP = 0.05
export const NEXT_TAB_SEQUENCE = "\u0002n"
export const PREVIOUS_TAB_SEQUENCE = "\u0002p"
export const TERMINAL_FONT_FAMILY = '"Ioskeley Mono Web", ui-monospace, "SF Mono", Menlo, monospace'
export const SOCKET_OPEN = 1

export type TerminalKey = { label: string; sequence?: string; control?: true }

// スマホで打ちにくいキー。Ctrl は次の 1 文字だけ。Terminal.tsx:31-42
export const TERMINAL_KEYS: readonly TerminalKey[] = [
  { label: "Esc", sequence: "\u001b" },
  { label: "Tab", sequence: "\t" },
  { label: "Ctrl", control: true },
  { label: "^B", sequence: "\u0002" },
  { label: "^C", sequence: "\u0003" },
  { label: "←", sequence: "\u001b[D" },
  { label: "↓", sequence: "\u001b[B" },
  { label: "↑", sequence: "\u001b[A" },
  { label: "→", sequence: "\u001b[C" },
  { label: "⏎", sequence: "\r" },
]

export const FONT_SMALLER_LABEL = "A\u2212"
export const FONT_LARGER_LABEL = "A+"

export type TerminalPane = {
  paneId: string
  label: string
  agent: string
  current: boolean
}

export type TerminalCopyClient = {
  listPanes: () => Promise<TerminalPane[]>
  readPane: (paneId: string) => Promise<string>
}

// proto に pane の一覧と本文が無いあいだのクライアント。シートは英語の理由を出す
export const unavailableTerminalCopyClient: TerminalCopyClient = {
  async listPanes() {
    throw new Error("terminal panes are unavailable: expected a pane list, actual none")
  },
  async readPane() {
    throw new Error("terminal pane text is unavailable: expected pane text, actual none")
  },
}

// トークンは付けない。docs/spec/security.md の「WebSocket」。cols と rows だけ
export function terminalWebSocketUrl(pageUrl: string, columns: number, rows: number): string {
  const page = new URL(pageUrl)
  const socket = new URL(TERMINAL_SOCKET_PATH, page)
  socket.protocol = page.protocol === "https:" ? "wss:" : "ws:"
  socket.search = ""
  socket.hash = ""
  socket.searchParams.set("cols", String(columns))
  socket.searchParams.set("rows", String(rows))
  return socket.toString()
}

export function resizePayload(columns: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols: columns, rows: rows })
}

export function encodeTerminalInput(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function terminalOutput(data: string | ArrayBuffer | ArrayBufferView): string | Uint8Array {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export function loadFontSize(stored: string | null, narrowScreen: boolean): number {
  const parsed = Number(stored)
  if (parsed >= MIN_FONT_SIZE && parsed <= MAX_FONT_SIZE) return parsed
  return narrowScreen ? 11 : 13
}

export function nextFontSize(current: number, delta: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, current + delta))
}

// Ctrl が付いているとき、次の 1 文字だけを制御文字にする。a は ^A。その 1 文字で Ctrl は外れる
// 1 文字でなければ Ctrl は残し、文字はそのまま送る。Terminal.tsx:99-107
export function applyControl(data: string, armed: boolean): { data: string; armed: boolean } {
  if (armed && data.length === 1) {
    const code = data.toLowerCase().charCodeAt(0)
    if (code >= 97 && code <= 122) {
      return { data: String.fromCharCode(code - 96), armed: false }
    }
    return { data, armed: false }
  }
  return { data, armed }
}

export function cleanPaneText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")
}

export function orderPanes<Pane extends { current: boolean }>(panes: readonly Pane[]): Pane[] {
  return [...panes].sort((left, right) => Number(right.current) - Number(left.current))
}

export function initialPaneId(
  panes: readonly { paneId: string; current: boolean; agent: string }[],
): string | null {
  const selected =
    panes.find((pane) => pane.current) ?? panes.find((pane) => pane.agent !== "") ?? panes[0]
  return selected?.paneId ?? null
}

export type GesturePoint = { clientX: number; clientY: number; timeStamp: number }

export type Gesture = {
  originX: number
  originY: number
  startedAt: number
  axis?: "x" | "y"
  lastY: number
  lastAt: number
  accumulator: number
  velocity: number
}

// 画面端はブラウザの戻るに譲る。指が 1 本のときだけ追う。Terminal.tsx:154-164
export function beginGesture(
  point: GesturePoint,
  touchCount: number,
  viewportWidth: number,
): Gesture | undefined {
  if (touchCount !== 1) return undefined
  if (point.clientX <= SWIPE_EDGE_PX || point.clientX >= viewportWidth - SWIPE_EDGE_PX) {
    return undefined
  }
  return {
    originX: point.clientX,
    originY: point.clientY,
    startedAt: point.timeStamp,
    axis: undefined,
    lastY: point.clientY,
    lastAt: point.timeStamp,
    accumulator: 0,
    velocity: 0,
  }
}

export function moveGesture(
  gesture: Gesture,
  point: GesturePoint,
): { gesture: Gesture; capture: boolean; stepY: number } {
  const deltaX = point.clientX - gesture.originX
  const deltaY = point.clientY - gesture.originY
  const next: Gesture = { ...gesture }
  if (next.axis === undefined && Math.hypot(deltaX, deltaY) > 10) {
    next.axis = Math.abs(deltaY) > Math.abs(deltaX) ? "y" : "x"
  }
  if (next.axis !== "y") return { gesture: next, capture: false, stepY: 0 }
  const stepY = point.clientY - next.lastY
  const elapsed = Math.max(1, point.timeStamp - next.lastAt)
  next.velocity = 0.8 * (stepY / elapsed) + 0.2 * next.velocity
  next.lastY = point.clientY
  next.lastAt = point.timeStamp
  return { gesture: next, capture: true, stepY }
}

export type GestureEnd =
  | { kind: "inertia"; velocity: number }
  | { kind: "swipe"; sequence: string; hint: string }
  | { kind: "none" }

// 左へ払うと次のタブ (^B n)、右へ払うと前のタブ (^B p)。縦はスクロールの惰性。Terminal.tsx:187-216
export function endGesture(gesture: Gesture | undefined, point: GesturePoint | undefined): GestureEnd {
  if (!gesture || !point) return { kind: "none" }
  if (gesture.axis === "y") {
    if (Math.abs(gesture.velocity) > INERTIA_START) return { kind: "inertia", velocity: gesture.velocity }
    return { kind: "none" }
  }
  const deltaX = point.clientX - gesture.originX
  const deltaY = point.clientY - gesture.originY
  if (point.timeStamp - gesture.startedAt > SWIPE_MAX_MS) return { kind: "none" }
  if (Math.abs(deltaX) < SWIPE_MIN_X_PX || Math.abs(deltaY) > Math.abs(deltaX) * 0.5) {
    return { kind: "none" }
  }
  if (deltaX < 0) return { kind: "swipe", sequence: NEXT_TAB_SEQUENCE, hint: "次のタブ →" }
  return { kind: "swipe", sequence: PREVIOUS_TAB_SEQUENCE, hint: "← 前のタブ" }
}

// 指を上へ動かすと新しい方へ進む。wheel に渡す行数は dy の符号を反転する。Terminal.tsx:144-151
export function advanceScroll(
  accumulator: number,
  deltaY: number,
  rowHeight: number,
): { accumulator: number; wheelLines: number } {
  if (rowHeight === 0) return { accumulator, wheelLines: 0 }
  const next = accumulator + deltaY
  const lines = Math.trunc(next / rowHeight)
  if (lines === 0) return { accumulator: next, wheelLines: 0 }
  return { accumulator: next - lines * rowHeight, wheelLines: -lines }
}

export function decayVelocity(velocity: number, elapsedMilliseconds: number): number {
  return velocity * Math.pow(0.95, elapsedMilliseconds / 16)
}
