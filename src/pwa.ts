import type { Hono } from "hono"
import { iconImage } from "./icon-images"
import { logoSvg, type LogoFrame } from "./logo"

// ホーム画面に置いて単独のアプリとして開けるようにする Web App Manifest とアイコン https://www.w3.org/TR/appmanifest/
// 1 つの yaru serve では全ワークスペースを /p/<slug>/ の下に配るので、アプリの入口は一覧の / にする
// Chrome のインストール条件は Service Worker を求めない https://web.dev/articles/install-criteria
// 板は SSE で常に最新を映すので、古い画面を返しかねないキャッシュ用の Service Worker は置かない

export const THEME_COLOR = "#010102"

export type IconImage = {
  file: string
  size: number
  frame: LogoFrame
}

// assets/icons にコミットしている PNG。bun run icons でロゴから作り直す
export const ICON_IMAGES: IconImage[] = [
  { file: "apple-touch-icon.png", size: 180, frame: "square" },
  { file: "icon-192.png", size: 192, frame: "rounded" },
  { file: "icon-512.png", size: 512, frame: "rounded" },
  { file: "icon-maskable-512.png", size: 512, frame: "maskable" },
]

const MANIFEST = {
  name: "yaru",
  short_name: "yaru",
  description: "Local issues. Markdown in .yaru.",
  start_url: "/",
  scope: "/",
  display: "fullscreen",
  background_color: THEME_COLOR,
  theme_color: THEME_COLOR,
  icons: [
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}

export function registerPwaRoutes(app: Hono) {
  app.get("/manifest.webmanifest", (c) =>
    c.body(JSON.stringify(MANIFEST), 200, { "content-type": "application/manifest+json" }),
  )
  app.get("/icon.svg", (c) => c.body(logoSvg("rounded"), 200, { "content-type": "image/svg+xml" }))
  for (const image of ICON_IMAGES) {
    app.get(`/${image.file}`, async (c) =>
      c.body(await iconImage(image.file), 200, { "content-type": "image/png" }),
    )
  }
}
