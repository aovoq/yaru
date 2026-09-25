import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Store } from "./store"

// .yaru/config.yml から 1 つの設定を読む
// config.yml は「key: value」の 1 行ずつだけを読む。YAML の他の書き方 (入れ子や複数行) は使わない
// 値の中の「: 」は区切りとみなさず、そのまま値に含める (通知のコマンドに含まれることがあるため)
// https://yaml.org/spec/1.2.2/#flow-scalar-styles
export function readConfigValue(store: Store, key: string): string | null {
  const path = join(store.dir, "config.yml")
  if (!existsSync(path)) return null
  const prefix = `${key}:`
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.startsWith(prefix)) continue
    const value = line.slice(prefix.length).trim()
    return value || null
  }
  return null
}
