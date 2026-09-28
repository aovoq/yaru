import { create } from "@bufbuild/protobuf"
import { createRouterTransport } from "@connectrpc/connect"
import { expect, test } from "vitest"
import { WatchService, WatchWorkspaceResponseSchema } from "../gen/yaru/v1/watch_pb"
import { subscribeWorkspace } from "./watch"

function event(name: "ready" | "change" | "heartbeat") {
  return create(WatchWorkspaceResponseSchema, { event: { case: name, value: {} } })
}

function sleepImmediately(_milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("aborted"))
  return Promise.resolve()
}

// docs/spec/routes.md の「ライブ更新」。ready と change は取り直す。heartbeat は取り直さない。
// 切れたらつなぎ直し、次の ready で取り直す。今の板は最初の接続では読み直さない (src/client/use-page-controller.ts:99-106)。
test("refetches on ready and change, ignores heartbeat, and refetches again after reconnect", async () => {
  const workspaces: string[] = []
  let opened = 0
  const transport = createRouterTransport(({ service }) => {
    service(WatchService, {
      async *watchWorkspace(request, context) {
        workspaces.push(request.workspace)
        opened += 1
        if (opened === 1) {
          yield event("heartbeat")
          yield event("change")
          while (refetches.length < 1) await new Promise((resolve) => setTimeout(resolve, 1))
          return
        }
        yield event("ready")
        yield event("heartbeat")
        while (refetches.length < 2) await new Promise((resolve) => setTimeout(resolve, 1))
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => resolve(), { once: true })
        })
      },
    })
  })
  const refetches: string[] = []
  const abort = new AbortController()
  const done = subscribeWorkspace({
    transport,
    workspace: "app",
    refetch: () => refetches.push("refetch"),
    signal: abort.signal,
    reconnectDelayMs: 0,
    refetchDelayMs: 0,
    sleep: sleepImmediately,
  })
  await viWaitFor(() => refetches.length >= 2)
  abort.abort()
  await done

  expect(workspaces).toEqual(["app", "app"])
  expect(refetches).toEqual(["refetch", "refetch"])
})

test("does not refetch when the stream only sends heartbeats", async () => {
  const transport = createRouterTransport(({ service }) => {
    service(WatchService, {
      async *watchWorkspace(_request, context) {
        yield event("heartbeat")
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) {
            resolve()
            return
          }
          context.signal.addEventListener("abort", () => resolve(), { once: true })
        })
      },
    })
  })
  const refetches: string[] = []
  const abort = new AbortController()
  const done = subscribeWorkspace({
    transport,
    workspace: "app",
    refetch: () => refetches.push("refetch"),
    signal: abort.signal,
    reconnectDelayMs: 0,
    refetchDelayMs: 0,
    sleep: sleepImmediately,
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(refetches).toEqual([])
  abort.abort()
  await done
  expect(refetches).toEqual([])
})

test("stops without reconnecting when the signal is already aborted", async () => {
  let opened = 0
  const transport = createRouterTransport(({ service }) => {
    service(WatchService, {
      async *watchWorkspace() {
        opened += 1
        yield event("ready")
      },
    })
  })
  const abort = new AbortController()
  abort.abort()
  await subscribeWorkspace({
    transport,
    workspace: "app",
    refetch: () => {
      throw new Error("refetch should not run")
    },
    signal: abort.signal,
    sleep: sleepImmediately,
  })
  expect(opened).toBe(0)
})

async function viWaitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (predicate()) return
    if (Date.now() - started > 2000) throw new Error("timed out waiting for watch refetch")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
