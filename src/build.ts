import { chmodSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import type { BunPlugin } from "bun"
import { clientScript } from "./client-script"

// Bun の実行時は JSX の変換設定を作業ディレクトリの tsconfig.json からしか読まないため、
// src を bin にすると yaru リポジトリの外で hono/jsx ではなく react/jsx-dev-runtime を探して落ちる
// ビルド時に変換を済ませた単一の JS を bin にして、実行場所に依存しないようにする
// compile した単一バイナリは Nix の bun が参照する ICU の store path を焼き込み、GC 後に起動しなくなるため使わない
export async function buildDistribution(
  outfile = resolve(import.meta.dir, "..", "dist", "yaru.js"),
): Promise<void> {
  const embeddedScript = await clientScript()
  const clientScriptModule = resolve(import.meta.dir, "client-script.ts")
  const plugin: BunPlugin = {
    name: "embed-client-script",
    setup(builder) {
      builder.onLoad({ filter: /client-script\.ts$/ }, ({ path }) => {
        if (resolve(path) !== clientScriptModule) return undefined
        return {
          contents: `export function clientScript() { return Promise.resolve(${JSON.stringify(embeddedScript)}) }`,
          loader: "ts",
        }
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
