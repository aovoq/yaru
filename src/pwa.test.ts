import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Hono } from "hono"
import { ICON_IMAGES, renderIconImage } from "./icons"
import { iconImage } from "./icon-images"
import { init } from "./store"
import { createApp, createServerApp } from "./web"

// PWA の要件は https://www.w3.org/TR/appmanifest/ と Chrome のインストール条件 https://web.dev/articles/install-criteria に従う
// "icons - must include a 192px and a 512px icon"

const directories: string[] = []

function directory(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), prefix))
  directories.push(path)
  return path
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string }

// PNG の幅と高さは IHDR チャンクの 16 から 23 バイト目に入っている https://www.w3.org/TR/png-3/#11IHDR
function pngSize(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return `${view.getUint32(16)}x${view.getUint32(20)}`
}

function apps(): [string, Hono][] {
  return [
    ["workspace app", createApp(init(directory("yaru-pwa-")))],
    ["server app", createServerApp(directory("yaru-pwa-state-"))],
  ]
}

describe("pwa", () => {
  for (const [name, app] of apps()) {
    test(`${name} serves a manifest whose every icon exists with its declared size`, async () => {
      const response = await app.request("/manifest.webmanifest")
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("application/manifest+json")
      const manifest = (await response.json()) as {
        name: string
        short_name: string
        start_url: string
        scope: string
        display: string
        icons: ManifestIcon[]
      }
      expect(manifest.name).toBe("yaru")
      expect(manifest.short_name).toBe("yaru")
      expect(manifest.start_url).toBe("/")
      expect(manifest.scope).toBe("/")
      expect(manifest.display).toBe("standalone")
      const pngs = manifest.icons.filter((icon) => icon.type === "image/png")
      expect(pngs.map((icon) => icon.sizes)).toContain("192x192")
      expect(pngs.map((icon) => icon.sizes)).toContain("512x512")
      expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true)
      for (const icon of manifest.icons) {
        const iconResponse = await app.request(icon.src)
        expect(iconResponse.status).toBe(200)
        expect(iconResponse.headers.get("content-type")).toBe(icon.type)
        if (icon.type === "image/png") {
          expect(pngSize(new Uint8Array(await iconResponse.arrayBuffer()))).toBe(icon.sizes)
        }
      }
    })

    test(`${name} serves the apple touch icon at 180px`, async () => {
      const response = await app.request("/apple-touch-icon.png")
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/png")
      expect(pngSize(new Uint8Array(await response.arrayBuffer()))).toBe("180x180")
    })
  }

  test("every page links the manifest, the svg favicon and the apple touch icon", async () => {
    const store = init(directory("yaru-pwa-"))
    const state = directory("yaru-pwa-state-")
    const pages = [
      await createApp(store).request("/"),
      await createApp(store).request("/dashboard"),
      await createServerApp(state).request("/"),
    ]
    for (const page of pages) {
      const html = await page.text()
      expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"')
      expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/icon.svg"')
      expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"')
      expect(html).toContain('<meta name="theme-color" content="#010102"')
      expect(html).toContain('<meta name="apple-mobile-web-app-title" content="yaru"')
      expect(html).toContain('<meta name="mobile-web-app-capable" content="yes"')
      expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black"')
    }
  })

  // ホーム画面から開くとブラウザの戻るボタンが無いので、どの画面からもロゴで一覧へ戻れるようにする
  test("the board and the dashboard link the logo to the projects list", async () => {
    const store = init(directory("yaru-pwa-"))
    for (const path of ["/", "/dashboard"]) {
      const html = await (await createApp(store).request(path)).text()
      expect(html).toMatch(/<a href="\/" aria-label="Projects"[^>]*><svg/)
    }
  })

  // PNG は src/icons.ts がロゴの SVG から作ってコミットしている。ロゴだけ直して作り直し忘れるのを防ぐ
  test("committed icon images are rendered from the current logo", async () => {
    for (const image of ICON_IMAGES) {
      const committed = await iconImage(image.file)
      expect(Buffer.from(committed).equals(Buffer.from(renderIconImage(image)))).toBe(true)
    }
  })
})
