import type { ComponentChildren } from "preact"
import { THEME_COLOR } from "../pwa"

// サーバーで描く全ての画面が共通に持つ html の外枠。head の設定と、板のクライアントの読み込みを受け持つ
// script を渡すとその inline script を使い、板のクライアント (app.js) を読まない

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 280

// サイドバーの開閉と幅を描く前に当てる。クライアントが動いてから当てると、閉じたサイドバーが一瞬見えてしまうため
const SIDEBAR_BOOT = `try{if(localStorage.getItem("yaru.sidebar.open")==="0")document.documentElement.setAttribute("data-sidebar","closed");var w=+localStorage.getItem("yaru.sidebar.width");if(w>=${SIDEBAR_MIN})document.documentElement.style.setProperty("--sidebar-width",Math.min(${SIDEBAR_MAX},w)+"px")}catch(e){}`

export function Document({
  css,
  script,
  children,
}: {
  css: string
  script?: string
  children?: ComponentChildren
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>yaru</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="theme-color" content={THEME_COLOR} />
        {/* ホーム画面から開いたときに iOS でも単独の画面にする https://developer.apple.com/documentation/webkit/configuring-web-applications */}
        {/* 状態バーを透過させると上端の固定ヘッダーが隠れるので、透過しない黒にして画面の地の色に揃える */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="yaru" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT }} />
      </head>
      <body class="h-screen overflow-hidden bg-canvas font-sans text-[13px] leading-normal text-ink antialiased scheme-dark">
        <div id="root">{children}</div>
        {script !== undefined ? (
          <script dangerouslySetInnerHTML={{ __html: script }} />
        ) : (
          <script type="module" src="/assets/app.js" />
        )}
      </body>
    </html>
  )
}
