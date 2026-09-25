import type { ComponentChildren, VNode } from "preact"
import { renderToString } from "preact-render-to-string"
import { BoardPage as ClientBoardPage, type BoardPageProps } from "./client/app"
import { BLANK, DEFAULT_VIEW, parseView, type ViewMode } from "./page"
import { THEME_COLOR } from "./pwa"

export { BLANK, DEFAULT_VIEW, parseView }
export type { BoardPageProps, ViewMode }

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 280

const SIDEBAR_BOOT = `try{if(localStorage.getItem("yaru.sidebar.open")==="0")document.documentElement.setAttribute("data-sidebar","closed");var w=+localStorage.getItem("yaru.sidebar.width");if(w>=${SIDEBAR_MIN})document.documentElement.style.setProperty("--sidebar-width",Math.min(${SIDEBAR_MAX},w)+"px")}catch(e){}`

// script を渡すとその inline script を使い、板のクライアント (app.js) を読まない
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

// 板はサーバーで描いた HTML をブラウザで同じ部品が引き継ぐので、ブラウザに渡す初期状態も一緒に埋め込む
export function BoardPage(props: BoardPageProps) {
  const initialState = { ...props, view: props.view ?? DEFAULT_VIEW }
  return (
    <>
      <ClientBoardPage {...initialState} />
      <script
        id="yaru-initial-state"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: serialize(initialState) }}
      />
    </>
  )
}

export function ErrorView({ message }: { message: string }) {
  return (
    <main class="grid h-screen place-items-center">
      <div class="flex flex-col items-center gap-3 pb-16 text-center">
        <span class="grid size-10 place-items-center rounded-xl border border-hairline bg-surface-1 text-ink-tertiary">
          ×
        </span>
        <p class="text-[13px] text-ink-muted">{message}</p>
        <a
          href="/"
          class="text-xs text-primary-hover no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus/50"
        >
          back
        </a>
      </div>
    </main>
  )
}

// 画面全体の HTML を作る。サーバーの画面はここを通して描く
export function renderDocument(css: string, body: VNode, script?: string): string {
  return `<!DOCTYPE html>${renderToString(
    <Document css={css} script={script}>
      {body}
    </Document>,
  )}`
}

function serialize(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}
