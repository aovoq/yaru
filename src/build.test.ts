import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildDistribution } from "./build"
import { init } from "./store"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

// tsconfig.json を置かない作業ディレクトリから実行し、JSX の変換がリポジトリの tsconfig に依存しないことを確かめる
test("distribution script serves the embedded browser UI outside the repository", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yaru-build-"))
  directories.push(directory)
  init(directory)
  const executable = join(directory, "yaru.js")
  await buildDistribution(executable)

  const port = availablePort()
  const process = Bun.spawn([executable, "serve", "--port", String(port)], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const response = await waitForResponse(`http://127.0.0.1:${port}/assets/app.js`)
    expect(response.status).toBe(200)
    const script = await response.text()
    expect(script).toContain("yaru-initial-state")
    expect(script).toContain("EventSource")
  } finally {
    process.kill()
    await process.exited
  }
})

function availablePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port
  server.stop()
  return port
}

async function waitForResponse(url: string): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await fetch(url)
    } catch (error) {
      lastError = error
      await Bun.sleep(20)
    }
  }
  throw new Error(
    `server did not start: expected response from ${url}, actual ${String(lastError)}`,
  )
}
