import { chmodSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import type { BunPlugin } from "bun"
import { clientScript } from "./client-script"
import { iconImage } from "./icon-images"
import { ICON_IMAGES } from "./pwa"

// Bun の実行時は JSX の変換設定を作業ディレクトリの tsconfig.json からしか読まないため、
// src を bin にすると yaru リポジトリの外で hono/jsx ではなく react/jsx-dev-runtime を探して落ちる
// ビルド時に変換を済ませた単一の JS を bin にして、実行場所に依存しないようにする
// compile した単一バイナリは Nix の bun が参照する ICU の store path を焼き込み、GC 後に起動しなくなるため使わない
export async function buildDistribution(
  outfile = resolve(import.meta.dir, "..", "dist", "yaru.js"),
): Promise<void> {
  const embeddedScript = await clientScript()
  const embeddedIcons: Record<string, string> = {}
  for (const image of ICON_IMAGES) {
    embeddedIcons[image.file] = Buffer.from(await iconImage(image.file)).toString("base64")
  }
  // 実行時にリポジトリのファイルを読むモジュールを、ビルド時に読んだ中身を返すものに差し替える
  const embeddedModules = new Map([
    [
      resolve(import.meta.dir, "client-script.ts"),
      `export function clientScript() { return Promise.resolve(${JSON.stringify(embeddedScript)}) }`,
    ],
    [
      resolve(import.meta.dir, "icon-images.ts"),
      `const images = ${JSON.stringify(embeddedIcons)}
export function iconImage(file) {
  const image = images[file]
  if (image === undefined) throw new Error(\`icon image not embedded: expected one of ${Object.keys(embeddedIcons).join(", ")}, actual \${file}\`)
  return Promise.resolve(Uint8Array.from(Buffer.from(image, "base64")))
}`,
    ],
  ])
  const plugin: BunPlugin = {
    name: "embed-runtime-files",
    setup(builder) {
      builder.onLoad({ filter: /(client-script|icon-images)\.ts$/ }, ({ path }) => {
        const contents = embeddedModules.get(resolve(path))
        if (contents === undefined) return undefined
        return { contents, loader: "ts" }
      })
    },
  }
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "index.ts")],
    target: "bun",
    minify: true,
    plugins: [plugin],
    outdir: dirname(outfile),
    naming: basename(outfile),
  })
  if (!result.success) {
    throw new Error(
      `distribution build failed: expected success, actual ${result.logs.length} errors`,
    )
  }
  chmodSync(outfile, 0o755)
}

if (import.meta.main) {
  await buildDistribution()
  console.log("built yaru")
}
