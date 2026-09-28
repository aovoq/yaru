import preact from "@preact/preset-vite"
import { defineConfig } from "vitest/config"

// 画面のテストは bun:test ではなく vitest。web/ は bun のパッケージに入れない。
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
