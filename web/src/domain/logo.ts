// yaru のロゴ。線の値は src/logo.ts:5-16 と同じ

export const LOGO_COLOR = "#5e6ad2"
export const LOGO_GLYPH_COLOR = "#ffffff"
export const LOGO_VIEW_BOX = 512
export const LOGO_CORNER_RADIUS = 112
export const LOGO_GLYPH_PATH = "M160 212 L240 292 M352 140 L208 388"
export const LOGO_GLYPH_STROKE_WIDTH = 56

export type LogoFrame = "rounded" | "square" | "maskable"

const MASKABLE_GLYPH_SCALE = 0.8

export function logoSvg(frame: LogoFrame): string {
  const size = LOGO_VIEW_BOX
  const radius = frame === "rounded" ? ` rx="${LOGO_CORNER_RADIUS}"` : ""
  const scale = frame === "maskable" ? MASKABLE_GLYPH_SCALE : 1
  const offset = (size * (1 - scale)) / 2
  const transform = scale === 1 ? "" : ` transform="translate(${offset} ${offset}) scale(${scale})"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}"${radius} fill="${LOGO_COLOR}"/><path d="${LOGO_GLYPH_PATH}"${transform} fill="none" stroke="${LOGO_GLYPH_COLOR}" stroke-width="${LOGO_GLYPH_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}
