import { SOCKET_OPEN } from "./terminal-logic"

// ブラウザの WebSocket。テストは同じ形の偽物を渡す
export type TerminalSocket = {
  binaryType: BinaryType
  readyState: number
  send: (data: string | Uint8Array) => void
  close: () => void
  onopen: (() => void) | null
  onmessage: ((event: { data: string | ArrayBuffer | ArrayBufferView }) => void) | null
  onclose: (() => void) | null
}

export function openBrowserSocket(url: string): TerminalSocket {
  const socket = new WebSocket(url)
  const wrapped: TerminalSocket = {
    get binaryType() {
      return socket.binaryType
    },
    set binaryType(value: BinaryType) {
      socket.binaryType = value
    },
    get readyState() {
      return socket.readyState
    },
    send(data: string | Uint8Array) {
      if (typeof data === "string") {
        socket.send(data)
        return
      }
      socket.send(new Uint8Array(data))
    },
    close() {
      socket.close()
    },
    onopen: null,
    onmessage: null,
    onclose: null,
  }
  socket.onopen = () => wrapped.onopen?.()
  socket.onmessage = (event) => {
    wrapped.onmessage?.({ data: event.data as string | ArrayBuffer })
  }
  socket.onclose = () => wrapped.onclose?.()
  return wrapped
}

export function socketIsOpen(socket: TerminalSocket | null): boolean {
  return socket?.readyState === SOCKET_OPEN
}
