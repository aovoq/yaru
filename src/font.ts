import type { Hono } from "hono"
import { interFontFile } from "./font-file"

// 画面の欧文は Inter で描く。端末ごとに違う system-ui だと数字や記号の幅と字形が揃わないため
// 配るのは rsms/inter の公式リリース (v4.1) の InterVariable.woff2 をそのまま。fontsource の分割版は cv11 と ss01 の機能を落としているので使わない
// https://github.com/rsms/inter/releases/tag/v4.1 ライセンスは SIL Open Font License 1.1 (assets/fonts/LICENSE.txt)
// 版を URL に入れて、中身が変わらない限り同じ URL を長く覚えさせる
export const INTER_FONT_PATH = "/assets/inter-4.1.woff2"

export function registerFontRoutes(app: Hono): void {
  app.get(INTER_FONT_PATH, async (c) =>
    c.body(await interFontFile(), 200, {
      "content-type": "font/woff2",
      "cache-control": "public, max-age=31536000, immutable",
    }),
  )
}
