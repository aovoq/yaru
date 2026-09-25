import { join } from "node:path"

// assets/fonts にコミットしている Inter の可変フォントを読む
// bun run build では build.ts がこのモジュールをフォントを埋め込んだものに差し替え、dist/yaru.js 1 つで配れるようにする
export async function interFontFile(): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await Bun.file(
      join(import.meta.dir, "..", "assets", "fonts", "InterVariable.woff2"),
    ).arrayBuffer(),
  )
}
