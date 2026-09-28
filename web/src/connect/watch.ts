import { Code, ConnectError, createClient, type Transport } from "@connectrpc/connect"
import { WatchService } from "../gen/yaru/v1/watch_pb"

// 切れたらつなぎ直す。ready を受けたら取り直すので、切れていた間の変化も拾う
// change も取り直す。heartbeat は接続の維持だけで取り直さない (docs/spec/routes.md の「ライブ更新」)
// 今の板は最初の接続では読み直さない (src/client/use-page-controller.ts:99-106)。移行後は最初の ready でも取り直す
// 変化のまとまりは、板が GetPage の前に 80ms 待つのと同じ (src/client/use-page-controller.ts:94)

export const WATCH_RECONNECT_DELAY_MS = 1000
export const WATCH_REFETCH_DELAY_MS = 80

export function subscribeWorkspace(options: {
  transport: Transport
  workspace: string
  refetch: () => void
  signal: AbortSignal
  reconnectDelayMs?: number
  refetchDelayMs?: number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}): Promise<void> {
  const signal = options.signal
  const reconnectDelayMs = options.reconnectDelayMs ?? WATCH_RECONNECT_DELAY_MS
  const refetchDelayMs = options.refetchDelayMs ?? WATCH_REFETCH_DELAY_MS
  const sleep = options.sleep ?? delay
  const client = createClient(WatchService, options.transport)
  let refetchTimer: ReturnType<typeof setTimeout> | undefined

  const scheduleRefetch = () => {
    if (signal.aborted) return
    clearTimeout(refetchTimer)
    refetchTimer = setTimeout(() => {
      if (!signal.aborted) options.refetch()
    }, refetchDelayMs)
  }

  const run = async () => {
    try {
      while (!signal.aborted) {
        try {
          const stream = client.watchWorkspace({ workspace: options.workspace }, { signal })
          for await (const message of stream) {
            const name = message.event.case
            if (name === "ready" || name === "change") scheduleRefetch()
          }
        } catch (error) {
          if (signal.aborted || isCanceled(error)) break
        }
        if (signal.aborted) break
        try {
          await sleep(reconnectDelayMs, signal)
        } catch {
          break
        }
      }
    } finally {
      clearTimeout(refetchTimer)
    }
  }

  return run()
}

function isCanceled(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.Canceled
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error("aborted"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
