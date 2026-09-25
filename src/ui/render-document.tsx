import type { VNode } from "preact"
import { renderToString } from "preact-render-to-string"
import { Document } from "./document"

// サーバーで描く画面全体の HTML を作る。サーバーの画面はここを通して描く
export function renderDocument(css: string, body: VNode, script?: string): string {
  return `<!DOCTYPE html>${renderToString(
    <Document css={css} script={script}>
      {body}
    </Document>,
  )}`
}
