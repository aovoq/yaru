import { Code, ConnectError } from "@connectrpc/connect"
import { describe, expect, test } from "vitest"
import { createYaruClients, shouldRetryConnectError } from "./client"

// docs/spec/routes.md: クライアントは useHttpGet を有効にしない。手続きは全部 POST。
test("unary and server-streaming calls are POST and are not retried by the transport", async () => {
  const calls: { method: string; url: string }[] = []
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    calls.push({ method, url })
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  const clients = createYaruClients("http://127.0.0.1:47800", fetchImplementation)
  await clients.projects.listProjects({}).catch(() => undefined)
  const abort = new AbortController()
  const stream = clients.watch.watchWorkspace({ workspace: "app" }, { signal: abort.signal })
  await stream[Symbol.asyncIterator]()
    .next()
    .catch(() => undefined)
  abort.abort()

  expect(calls.map((call) => call.method)).toEqual(["POST", "POST"])
  expect(calls[0]?.url).toBe("http://127.0.0.1:47800/yaru.v1.ProjectService/ListProjects")
  expect(calls[1]?.url).toBe("http://127.0.0.1:47800/yaru.v1.WatchService/WatchWorkspace")
  expect(calls.filter((call) => call.url.endsWith("/ListProjects"))).toHaveLength(1)
})

// docs/spec/routes.md の「画面の送り直し」。新規作成は transport が自動では送らない。
describe("shouldRetryConnectError", () => {
  test("retries only unavailable, deadline exceeded, internal, and unknown", () => {
    for (const code of [Code.Unavailable, Code.DeadlineExceeded, Code.Internal, Code.Unknown]) {
      expect(shouldRetryConnectError(new ConnectError("down", code))).toBe(true)
    }
    for (const code of [
      Code.InvalidArgument,
      Code.NotFound,
      Code.Aborted,
      Code.FailedPrecondition,
      Code.Canceled,
    ]) {
      expect(shouldRetryConnectError(new ConnectError("no", code))).toBe(false)
    }
    expect(shouldRetryConnectError(new Error("network"))).toBe(false)
  })
})
