import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readConfigValue } from "./config"
import { init } from "./store"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test("reads one key: value line from config.yml and treats blank values as unset", () => {
  const root = mkdtempSync(join(tmpdir(), "yaru-config-"))
  dirs.push(root)
  const store = init(root)
  expect(readConfigValue(store, "staleAfter")).toBeNull()
  writeFileSync(
    join(store.dir, "config.yml"),
    "notify: curl -d 'a: b' https://ntfy.sh/x\nstaleAfter:\n  staleAfter: 1h\n",
  )
  expect(readConfigValue(store, "notify")).toBe("curl -d 'a: b' https://ntfy.sh/x")
  expect(readConfigValue(store, "staleAfter")).toBeNull()
  expect(readConfigValue(store, "missing")).toBeNull()
})
