import { afterEach, expect, test } from "vitest"
import type { ComponentChild } from "preact"
import { installTestDom } from "../test-dom"
import type { TerminalEngine } from "./terminal-engine"
import type { TerminalSocket } from "./terminal-socket"
import { TerminalView } from "./terminal-view"
import { FONT_SIZE_STORAGE_KEY, type TerminalCopyClient } from "./terminal-logic"

const testWindow = installTestDom()
let container: HTMLElement

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  testWindow.document.body.innerHTML = ""
  testWindow.localStorage.clear()
})

async function mount(node: ComponentChild): Promise<void> {
  const { render } = await import("preact")
  container = testWindow.document.createElement("div") as unknown as HTMLElement
  testWindow.document.body.appendChild(container as never)
  render(node, container)
  await settle()
}

async function settle(): Promise<void> {
  await new Promise((resolve) => testWindow.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

class FakeSocket implements TerminalSocket {
  binaryType: BinaryType = "blob"
  readyState = 0
  sent: Array<string | Uint8Array> = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string | ArrayBuffer | ArrayBufferView }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly url: string) {}
  send(data: string | Uint8Array): void {
    this.sent.push(data)
  }
  close(): void {
    this.readyState = 3
    this.onclose?.()
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
}

function createFakeEngine(): TerminalEngine & {
  written: Array<string | Uint8Array>
  fontSize: number
  opened: boolean
  disposed: boolean
  webgl: boolean
  fitted: number
  focused: number
  blurred: number
  resetCount: number
  emitData: (data: string) => void
  emitResize: () => void
} {
  let dataHandler = (_data: string) => {}
  let resizeHandler = () => {}
  const engine = {
    cols: 80,
    rows: 24,
    element: null as HTMLElement | null,
    fontSize: 13,
    opened: false,
    disposed: false,
    webgl: false,
    fitted: 0,
    focused: 0,
    blurred: 0,
    resetCount: 0,
    written: [] as Array<string | Uint8Array>,
    open(host: HTMLElement) {
      this.opened = true
      this.element = host
    },
    dispose() {
      this.disposed = true
    },
    write(data: string | Uint8Array) {
      this.written.push(data)
    },
    reset() {
      this.resetCount += 1
    },
    focus() {
      this.focused += 1
    },
    blur() {
      this.blurred += 1
    },
    fit() {
      this.fitted += 1
    },
    setFontSize(size: number) {
      this.fontSize = size
    },
    onData(handler: (data: string) => void) {
      dataHandler = handler
    },
    onBinary() {},
    onResize(handler: () => void) {
      resizeHandler = handler
    },
    attachWebGL() {
      this.webgl = true
    },
    emitData(data: string) {
      dataHandler(data)
    },
    emitResize() {
      resizeHandler()
    },
  }
  return engine
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label)
  if (!found) throw new Error(`missing button ${label}`)
  return found as HTMLButtonElement
}

const copyClient: TerminalCopyClient = {
  listPanes: async () => [{ paneId: "p1", label: "shell", agent: "", current: true }],
  readPane: async () => "output",
}

test("keys are sent as binary and the socket url has no token", async () => {
  const sockets: FakeSocket[] = []
  const engine = createFakeEngine()
  await mount(
    <TerminalView
      engine={engine}
      copyClient={copyClient}
      loadFont={async () => {}}
      openSocket={(url) => {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket
      }}
    />,
  )
  expect(container.textContent).toContain("接続中…")
  expect(sockets).toHaveLength(1)
  const socket = sockets[0]!
  expect(socket.url).toBe("ws://127.0.0.1/ws/terminal?cols=80&rows=24")
  expect(socket.url).not.toContain("token")
  expect(socket.binaryType).toBe("arraybuffer")
  expect(engine.webgl).toBe(true)
  expect(engine.fitted).toBeGreaterThan(0)
  socket.open()
  await settle()
  expect(container.textContent).not.toContain("接続中…")
  expect(engine.resetCount).toBe(1)
  button("Esc").click()
  expect(socket.sent).toEqual([new Uint8Array([0x1b])])
  button("Ctrl").click()
  await settle()
  expect(button("Ctrl").getAttribute("aria-pressed")).toBe("true")
  engine.emitData("c")
  await settle()
  expect(socket.sent[1]).toEqual(new Uint8Array([0x03]))
  expect(button("Ctrl").getAttribute("aria-pressed")).toBe("false")
  engine.emitResize()
  expect(socket.sent[2]).toBe('{"type":"resize","cols":80,"rows":24}')
  socket.onmessage?.({ data: "hello" })
  expect(engine.written).toContain("hello")
  const binary = new Uint8Array([65]).buffer
  socket.onmessage?.({ data: binary })
  expect(engine.written[1]).toEqual(new Uint8Array([65]))
})

test("closing the socket offers reconnect and font size is stored", async () => {
  const sockets: FakeSocket[] = []
  const engine = createFakeEngine()
  await mount(
    <TerminalView
      engine={engine}
      copyClient={copyClient}
      loadFont={async () => {}}
      openSocket={(url) => {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket
      }}
    />,
  )
  sockets[0]!.open()
  await settle()
  button("A+").click()
  await settle()
  expect(container.querySelector("[data-font-size]")?.textContent).toBe("14")
  expect(testWindow.localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe("14")
  expect(engine.fontSize).toBe(14)
  sockets[0]!.close()
  await settle()
  expect(container.textContent).toContain("切断されました")
  button("再接続").click()
  await settle()
  expect(sockets).toHaveLength(2)
  expect(sockets[1]!.url).toContain("cols=80")
  expect(container.querySelector('a[href="/"]')?.textContent).toBe("一覧")
})

test("copy blurs the terminal and unmount closes the socket", async () => {
  const sockets: FakeSocket[] = []
  const engine = createFakeEngine()
  await mount(
    <TerminalView
      engine={engine}
      copyClient={copyClient}
      loadFont={async () => {}}
      openSocket={(url) => {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket
      }}
    />,
  )
  sockets[0]!.open()
  await settle()
  button("コピー").click()
  await settle()
  expect(engine.blurred).toBe(1)
  expect(container.textContent).toContain("shell")
  const { render } = await import("preact")
  render(null, container)
  expect(engine.disposed).toBe(true)
  expect(sockets[0]!.readyState).toBe(3)
})
