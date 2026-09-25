// yaru のロゴ。左の腕がチェックマークになった「y」で、「やる」と「やった」を 1 つの字に重ねる
// 画面のロゴ・favicon・ホーム画面のアイコンは全てここから作る
// PNG へ描き出すときにフォントの有無で形が変わらないよう、文字ではなく線だけで描く

export const LOGO_COLOR = "#5e6ad2"
export const LOGO_GLYPH_COLOR = "#ffffff"
export const LOGO_VIEW_BOX = 512
export const LOGO_CORNER_RADIUS = 112
export const LOGO_GLYPH_PATH = "M160 212 L240 292 M352 140 L208 388"
export const LOGO_GLYPH_STROKE_WIDTH = 56

export type LogoFrame = "rounded" | "square" | "maskable"

// maskable アイコンは中心から半径 40% の円の内側だけが必ず見える https://www.w3.org/TR/appmanifest/#icon-masks
// "The safe zone is the area within a circle of radius 40% of the icon size"
// 字の端が円に収まるよう縮める
const MASKABLE_GLYPH_SCALE = 0.8

// rounded は favicon と manifest の any 用。square は iOS と maskable 用で、角は OS が丸めるので透明な部分を作らない
export function logoSvg(frame: LogoFrame): string {
  const size = LOGO_VIEW_BOX
  const radius = frame === "rounded" ? ` rx="${LOGO_CORNER_RADIUS}"` : ""
  const scale = frame === "maskable" ? MASKABLE_GLYPH_SCALE : 1
  const offset = (size * (1 - scale)) / 2
  const transform = scale === 1 ? "" : ` transform="translate(${offset} ${offset}) scale(${scale})"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}"${radius} fill="${LOGO_COLOR}"/><path d="${LOGO_GLYPH_PATH}"${transform} fill="none" stroke="${LOGO_GLYPH_COLOR}" stroke-width="${LOGO_GLYPH_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

// 画面の見出しに置く小さいロゴ。板 (Preact) とサーバーの画面 (hono/jsx) の両方から同じものを埋め込むため、SVG の文字列で作る
export function logoMarkMarkup(className: string): string {
  return `<svg class="${className}" viewBox="0 0 ${LOGO_VIEW_BOX} ${LOGO_VIEW_BOX}" aria-hidden="true"><rect width="${LOGO_VIEW_BOX}" height="${LOGO_VIEW_BOX}" rx="${LOGO_CORNER_RADIUS}" fill="${LOGO_COLOR}"/><path d="${LOGO_GLYPH_PATH}" fill="none" stroke="${LOGO_GLYPH_COLOR}" stroke-width="${LOGO_GLYPH_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

export const LOGO_MARK_CLASS = "size-5 shrink-0"

export const LOGO_LINK_CLASS =
  "shrink-0 rounded-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus/50"
