import type { VNode } from "preact"
import { renderToString } from "preact-render-to-string"
import type { BoardPageProps } from "./client/app"
import { BLANK, DEFAULT_VIEW, parseView, type ViewMode } from "./page"
import { Document } from "./ui/document"

// サーバーで描く画面の入口。web.tsx と css.tsx はここから読み込む
export { BoardPage } from "./ui/board-page"
export { Document } from "./ui/document"
export { ErrorView } from "./ui/error-view"
export { BLANK, DEFAULT_VIEW, parseView }
export type { BoardPageProps, ViewMode }

// 画面全体の HTML を作る。サーバーの画面はここを通して描く
export function renderDocument(css: string, body: VNode, script?: string): string {
  return `<!DOCTYPE html>${renderToString(
    <Document css={css} script={script}>
      {body}
    </Document>,
  )}`
}
