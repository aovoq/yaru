import { expect, test } from "bun:test"
import { join } from "node:path"

const cli = join(import.meta.dir, "index.ts")

function run(args: string[]) {
  return Bun.spawnSync(["bun", cli, ...args], { stdout: "pipe", stderr: "pipe" })
}

test("help exits 0", () => {
  expect(run(["--help"]).exitCode).toBe(0)
  expect(run(["-h"]).exitCode).toBe(0)
})

test("no args exits 1", () => {
  expect(run([]).exitCode).toBe(1)
})

test("bare value flags error instead of storing true", () => {
  const out = run(["issue", "save", "--title", "x", "--body"])
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain("missing value for --body")
})
