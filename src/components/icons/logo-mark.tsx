import {
  LOGO_COLOR,
  LOGO_CORNER_RADIUS,
  LOGO_GLYPH_COLOR,
  LOGO_GLYPH_PATH,
  LOGO_GLYPH_STROKE_WIDTH,
  LOGO_VIEW_BOX,
} from "../../logo"

// yaru のロゴ
export function LogoMark() {
  return (
    <svg
      class="size-5 shrink-0"
      viewBox={`0 0 ${LOGO_VIEW_BOX} ${LOGO_VIEW_BOX}`}
      aria-hidden="true"
    >
      <rect
        width={LOGO_VIEW_BOX}
        height={LOGO_VIEW_BOX}
        rx={LOGO_CORNER_RADIUS}
        fill={LOGO_COLOR}
      />
      <path
        d={LOGO_GLYPH_PATH}
        fill="none"
        stroke={LOGO_GLYPH_COLOR}
        stroke-width={LOGO_GLYPH_STROKE_WIDTH}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
