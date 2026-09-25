import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderToString } from "preact-render-to-string"
import { INTER_FONT_PATH } from "./font"
import { init } from "./store"
import { Document } from "./ui/document"
import { createApp, createServerApp } from "./web"

const directories: string[] = []

function directory(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), prefix))
  directories.push(path)
  return path
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

// woff2 の先頭 4 バイトは "wOF2" https://www.w3.org/TR/WOFF2/#woff20Header
// "signature: 0x774F4632 'wOF2'"
test("both the workspace app and the server app serve the bundled Inter font", async () => {
  for (const app of [
    createApp(init(directory("yaru-font-"))),
    createServerApp(directory("yaru-font-state-")),
  ]) {
    const response = await app.request(INTER_FONT_PATH)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("font/woff2")
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("wOF2")
  }
})

// preload の取得は CORS モードで行われるので、crossorigin が無いと @font-face の取得と別物になり 2 回落とす
// https://html.spec.whatwg.org/multipage/links.html#link-type-preload
test("the document preloads the font in the same CORS mode as @font-face", () => {
  const html = renderToString(<Document css="" />)
  expect(html).toContain(`href="${INTER_FONT_PATH}"`)
  expect(html).toMatch(/<link rel="preload"[^>]*crossorigin/)
})
