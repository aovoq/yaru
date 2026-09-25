import { join } from "node:path"

// assets/icons にコミットしている PNG を読む
// bun run build では build.ts がこのモジュールを PNG を埋め込んだものに差し替え、dist/yaru.js 1 つで配れるようにする
export async function iconImage(file: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await Bun.file(join(import.meta.dir, "..", "assets", "icons", file)).arrayBuffer(),
  )
}
