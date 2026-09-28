import { expect, test } from "vitest"
import {
  DOCUMENT_CONTENT_SECURITY_POLICY,
  FONT_LARGER_LABEL,
  FONT_SMALLER_LABEL,
  NEXT_TAB_SEQUENCE,
  PREVIOUS_TAB_SEQUENCE,
  TERMINAL_CONTENT_SECURITY_POLICY,
  TERMINAL_KEYS,
  advanceScroll,
  applyControl,
  beginGesture,
  cleanPaneText,
  decayVelocity,
  endGesture,
  initialPaneId,
  loadFontSize,
  moveGesture,
  nextFontSize,
  orderPanes,
  resizePayload,
  terminalOutput,
  terminalWebSocketUrl,
} from "./terminal-logic"

test("the terminal document is the only page whose style-src allows unsafe-inline", () => {
  expect(DOCUMENT_CONTENT_SECURITY_POLICY).toContain("style-src 'self';")
  expect(DOCUMENT_CONTENT_SECURITY_POLICY).not.toContain("style-src 'self' 'unsafe-inline'")
  expect(TERMINAL_CONTENT_SECURITY_POLICY).toContain("style-src 'self' 'unsafe-inline';")
  expect(TERMINAL_CONTENT_SECURITY_POLICY).toContain("style-src-attr 'unsafe-inline'")
  expect(TERMINAL_CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' 'unsafe-inline'")
  expect(TERMINAL_CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval")
  expect(TERMINAL_CONTENT_SECURITY_POLICY).not.toContain("style-src-attr 'self' 'unsafe-inline'")
})

test("the websocket url carries size only and never a token", () => {
  expect(terminalWebSocketUrl("http://127.0.0.1:47800/terminal?token=secret", 80, 24)).toBe(
    "ws://127.0.0.1:47800/ws/terminal?cols=80&rows=24",
  )
  expect(terminalWebSocketUrl("https://mac.example.ts.net/p/app/#card", 100, 40)).toBe(
    "wss://mac.example.ts.net/ws/terminal?cols=100&rows=40",
  )
})

test("resize is a text frame with type, cols, and rows", () => {
  expect(resizePayload(120, 50)).toBe('{"type":"resize","cols":120,"rows":50}')
})

test("terminal output keeps strings and wraps binary frames", () => {
  expect(terminalOutput("hello")).toBe("hello")
  const bytes = new Uint8Array([65, 66])
  expect(terminalOutput(bytes.buffer)).toEqual(new Uint8Array([65, 66]))
  expect(terminalOutput(bytes)).toEqual(new Uint8Array([65, 66]))
})

test("font size stays inside 8 to 24 and defaults by screen width", () => {
  expect(loadFontSize(null, false)).toBe(13)
  expect(loadFontSize(null, true)).toBe(11)
  expect(loadFontSize("12", false)).toBe(12)
  expect(loadFontSize("7", true)).toBe(11)
  expect(loadFontSize("25", false)).toBe(13)
  expect(loadFontSize("no", false)).toBe(13)
  expect(nextFontSize(13, 1)).toBe(14)
  expect(nextFontSize(24, 1)).toBe(24)
  expect(nextFontSize(8, -1)).toBe(8)
  expect(FONT_SMALLER_LABEL).toBe("A\u2212")
  expect(FONT_LARGER_LABEL).toBe("A+")
})

test("control applies to the next single letter and then turns off", () => {
  expect(applyControl("a", false)).toEqual({ data: "a", armed: false })
  expect(applyControl("a", true)).toEqual({ data: "\u0001", armed: false })
  expect(applyControl("B", true)).toEqual({ data: "\u0002", armed: false })
  expect(applyControl("1", true)).toEqual({ data: "1", armed: false })
  expect(applyControl("ab", true)).toEqual({ data: "ab", armed: true })
})

test("the key row matches the resident sequences", () => {
  expect(TERMINAL_KEYS.map((key) => key.label)).toEqual([
    "Esc",
    "Tab",
    "Ctrl",
    "^B",
    "^C",
    "←",
    "↓",
    "↑",
    "→",
    "⏎",
  ])
  expect(TERMINAL_KEYS.find((key) => key.label === "Esc")?.sequence).toBe("\u001b")
  expect(TERMINAL_KEYS.find((key) => key.label === "^C")?.sequence).toBe("\u0003")
  expect(TERMINAL_KEYS.find((key) => key.label === "Ctrl")?.control).toBe(true)
})

test("pane text drops trailing spaces and trailing blank lines", () => {
  expect(cleanPaneText("hello  \nb\t\n\n")).toBe("hello\nb")
})

test("the focused pane is listed and selected first", () => {
  const panes = [
    { paneId: "idle", label: "shell", agent: "", current: false },
    { paneId: "agent", label: "review", agent: "grok", current: false },
    { paneId: "focus", label: "here", agent: "", current: true },
  ]
  expect(orderPanes(panes).map((pane) => pane.paneId)).toEqual(["focus", "idle", "agent"])
  expect(initialPaneId(panes)).toBe("focus")
  expect(
    initialPaneId([
      { paneId: "idle", current: false, agent: "" },
      { paneId: "agent", current: false, agent: "grok" },
    ]),
  ).toBe("agent")
  expect(initialPaneId([])).toBeNull()
})

test("a touch at the screen edge is left to the browser", () => {
  expect(beginGesture({ clientX: 24, clientY: 100, timeStamp: 0 }, 1, 400)).toBeUndefined()
  expect(beginGesture({ clientX: 376, clientY: 100, timeStamp: 0 }, 1, 400)).toBeUndefined()
  expect(beginGesture({ clientX: 100, clientY: 10, timeStamp: 0 }, 2, 400)).toBeUndefined()
  expect(beginGesture({ clientX: 25, clientY: 10, timeStamp: 0 }, 1, 400)).toBeDefined()
})

test("a horizontal flick moves tabs and a vertical drag does not", () => {
  const started = beginGesture({ clientX: 200, clientY: 100, timeStamp: 0 }, 1, 400)
  if (!started) throw new Error("gesture")
  const horizontal = moveGesture(started, { clientX: 100, clientY: 110, timeStamp: 40 })
  expect(horizontal.capture).toBe(false)
  expect(horizontal.gesture.axis).toBe("x")
  expect(endGesture(horizontal.gesture, { clientX: 100, clientY: 110, timeStamp: 80 })).toEqual({
    kind: "swipe",
    sequence: NEXT_TAB_SEQUENCE,
    hint: "次のタブ →",
  })
  expect(endGesture(horizontal.gesture, { clientX: 300, clientY: 110, timeStamp: 80 })).toEqual({
    kind: "swipe",
    sequence: PREVIOUS_TAB_SEQUENCE,
    hint: "← 前のタブ",
  })
  expect(endGesture(horizontal.gesture, { clientX: 100, clientY: 110, timeStamp: 700 })).toEqual({
    kind: "none",
  })
  expect(endGesture(horizontal.gesture, { clientX: 170, clientY: 100, timeStamp: 80 })).toEqual({
    kind: "none",
  })

  const vertical = moveGesture(started, { clientX: 205, clientY: 40, timeStamp: 30 })
  expect(vertical.capture).toBe(true)
  expect(vertical.gesture.axis).toBe("y")
  expect(vertical.stepY).toBe(-60)
  const ended = endGesture(vertical.gesture, { clientX: 205, clientY: 40, timeStamp: 40 })
  expect(ended.kind).toBe("inertia")
})

test("scrolling up moves toward newer lines by whole rows", () => {
  expect(advanceScroll(0, -25, 10)).toEqual({ accumulator: -5, wheelLines: 2 })
  expect(advanceScroll(0, 9, 10)).toEqual({ accumulator: 9, wheelLines: 0 })
  expect(decayVelocity(1, 16)).toBeCloseTo(0.95)
})
