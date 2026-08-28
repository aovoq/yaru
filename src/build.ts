import { resolve } from "node:path"
import type { BunPlugin } from "bun"
import { clientScript } from "./client-script"

export async function buildStandalone(
  outfile = resolve(import.meta.dir, "..", "yaru"),
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
    compile: { outfile },
  })
  if (!result.success) {
    throw new Error(
      `standalone build failed: expected success, actual ${result.logs.length} errors`,
    )
  }
}

if (import.meta.main) {
  await buildStandalone()
  console.log("built yaru")
}
