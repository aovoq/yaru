import { join } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import { logoSvg } from "./logo"
import { ICON_IMAGES, type IconImage } from "./pwa"

// ロゴの SVG から assets/icons の PNG を作る。ロゴを直したら bun run icons で作り直してコミットする
// iOS の apple-touch-icon と manifest の PNG アイコンは SVG を受け付けないので PNG で持つ https://developer.apple.com/documentation/webkit/configuring-web-applications

export { ICON_IMAGES }

export function renderIconImage(image: IconImage): Uint8Array {
  const renderer = new Resvg(logoSvg(image.frame), { fitTo: { mode: "width", value: image.size } })
  return renderer.render().asPng()
}

if (import.meta.main) {
  for (const image of ICON_IMAGES) {
    await Bun.write(
      join(import.meta.dir, "..", "assets", "icons", image.file),
      renderIconImage(image),
    )
  }
  console.log(`rendered ${ICON_IMAGES.length} icons`)
}
