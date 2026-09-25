import type { VNode } from "preact"
import { renderToString } from "preact-render-to-string"
import { Document } from "./document"

// サーバーで描く画面全体の HTML を作る。サーバーの画面はここを通して描く
// script を渡すとその inline script を使い、板のクライアントを読まない。title はタブと履歴に出す名前 (page-title.ts)
export function renderDocument(
  css: string,
  body: VNode,
  options: { script?: string; title?: string } = {},
): string {
  return `<!DOCTYPE html>${renderToString(
    <Document css={css} script={options.script} title={options.title}>
      {body}
    </Document>,
  )}`
}
