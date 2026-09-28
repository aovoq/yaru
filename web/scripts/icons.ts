import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Resvg } from "@resvg/resvg-js"
import { logoSvg, type LogoFrame } from "../src/domain/logo.ts"

// ロゴの SVG から public の icon.svg と PNG を作る。ロゴを直したら npm run icons で作り直してコミットする
// iOS の apple-touch-icon と manifest の PNG アイコンは SVG を受け付けないので PNG で持つ https://developer.apple.com/documentation/webkit/configuring-web-applications
// Vite が public をそのまま web/dist に写し、Go の yaru serve はそれを静的ファイルとして配る

type IconImage = {
  file: string
  size: number
  frame: LogoFrame
}

const ICON_IMAGES: IconImage[] = [
  { file: "apple-touch-icon.png", size: 180, frame: "square" },
  { file: "icon-192.png", size: 192, frame: "rounded" },
  { file: "icon-512.png", size: 512, frame: "rounded" },
  { file: "icon-maskable-512.png", size: 512, frame: "maskable" },
]

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "public")
mkdirSync(outputDirectory, { recursive: true })
writeFileSync(join(outputDirectory, "icon.svg"), logoSvg("rounded"))
for (const image of ICON_IMAGES) {
  const renderer = new Resvg(logoSvg(image.frame), { fitTo: { mode: "width", value: image.size } })
  writeFileSync(join(outputDirectory, image.file), renderer.render().asPng())
}
console.log(`rendered icon.svg and ${ICON_IMAGES.length} png icons`)
