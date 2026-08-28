import { join } from "node:path"

let cachedClientScript: Promise<string> | undefined

export function clientScript(): Promise<string> {
  cachedClientScript ??= buildClientScript()
  return cachedClientScript
}

async function buildClientScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "client", "main.tsx")],
    target: "browser",
    format: "esm",
    minify: true,
    tsconfig: join(import.meta.dir, "..", "tsconfig.client.json"),
  })
  if (!result.success || result.outputs.length !== 1) {
    throw new Error(`client build failed: expected 1 output, actual ${result.outputs.length}`)
  }
  return result.outputs[0]!.text()
}
