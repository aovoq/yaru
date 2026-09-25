/** @jsxImportSource preact */

import { renderToString } from "preact-render-to-string"
import type { Issue } from "../store"
import { BoardPage, type BoardPageProps } from "./app"
import { ContextMenu, Notice } from "./context-menu"
import { issueMenu } from "./issue-menu"

// 板の画面はブラウザで Preact が動かすので、サーバーで最初の HTML を描くときも Preact で描く
// サーバー側の画面 (hono/jsx) の中からは、ここで作った文字列を埋め込む

export function renderBoardPage(props: BoardPageProps): string {
  return renderToString(<BoardPage {...props} />)
}

// 右クリックのメニューと知らせは操作したあとにしか描かれないので、CSS の見本のためにここで描く
export function renderInteractionSamples(issue: Issue, issues: Issue[]): string {
  return renderToString(
    <>
      <ContextMenu
        menu={{
          items: issueMenu(issue, issues, { now: new Date(0), boardUrl: "http://x/" }),
          x: 0,
          y: 0,
        }}
        onAction={() => {}}
        onClose={() => {}}
      />
      <Notice text="x" />
    </>,
  )
}
