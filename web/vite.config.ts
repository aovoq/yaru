import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// 成果物は web/dist。Go がこのディレクトリを embed して配る
// フォント・アイコン・manifest は public に置き、ハッシュを付けずに dist の同じパスへ写す
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
