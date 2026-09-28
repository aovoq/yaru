import { copyFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, type Plugin } from "vite"

// 成果物は web/dist。Go がこのディレクトリを embed して配る
// /assets/inter-4.1.woff2 はハッシュを付けず、src/font.ts と同じ URL のまま置く
export default defineConfig({
  plugins: [preact(), tailwindcss(), interFont()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})

function interFont(): Plugin {
  let destination = ""
  let source = ""
  return {
    name: "yaru-inter-font",
    apply: "build",
    configResolved(config) {
      destination = resolve(config.root, config.build.outDir, "assets")
      source = resolve(config.root, "../assets/fonts/InterVariable.woff2")
    },
    closeBundle() {
      mkdirSync(destination, { recursive: true })
      copyFileSync(source, resolve(destination, "inter-4.1.woff2"))
    },
  }
}
