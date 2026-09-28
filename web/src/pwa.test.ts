import { existsSync, readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { logoSvg } from "./domain/logo"

// ホーム画面に置いて単独のアプリとして開けるようにする Web App Manifest とアイコン https://www.w3.org/TR/appmanifest/
// どれも web/public のファイルで、Go は web/dist に写ったものを配るだけ

const publicFile = (name: string) => new URL(`../public/${name}`, import.meta.url)

test("the favicon is the rounded logo, so npm run icons keeps it in step with the logo", () => {
  expect(readFileSync(publicFile("icon.svg"), "utf8")).toBe(logoSvg("rounded"))
})

test("the manifest opens the workspace list and every icon it names exists", () => {
  const manifest = JSON.parse(readFileSync(publicFile("manifest.webmanifest"), "utf8"))
  expect(manifest.start_url).toBe("/")
  expect(manifest.scope).toBe("/")
  expect(manifest.display).toBe("fullscreen")
  expect(manifest.theme_color).toBe("#010102")
  expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toContain("maskable")
  for (const icon of manifest.icons as { src: string }[]) {
    expect(existsSync(publicFile(icon.src.slice(1)))).toBe(true)
  }
})
