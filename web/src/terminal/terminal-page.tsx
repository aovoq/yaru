import { TerminalView } from "./terminal-view"
import type { TerminalCopyClient } from "./terminal-logic"

// /terminal の入口。この path の文書だけ style-src に unsafe-inline を付ける
// docs/spec/security.md の「決定 (2026-09-28)」
export function TerminalPage({ copyClient }: { copyClient?: TerminalCopyClient }) {
  return <TerminalView copyClient={copyClient} />
}
