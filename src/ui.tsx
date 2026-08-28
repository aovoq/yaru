import type { PropsWithChildren } from "hono/jsx"
import { renderToString } from "hono/jsx/dom/server"
import { BoardPage as ClientBoardPage, type BoardPageProps } from "./client/app"
import { BLANK, DEFAULT_VIEW, parseView, type ViewMode } from "./page"

export { BLANK, DEFAULT_VIEW, parseView }
export type { BoardPageProps, ViewMode }

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 280

const SIDEBAR_BOOT = `try{if(localStorage.getItem("yaru.sidebar.open")==="0")document.documentElement.setAttribute("data-sidebar","closed");var w=+localStorage.getItem("yaru.sidebar.width");if(w>=${SIDEBAR_MIN})document.documentElement.style.setProperty("--sidebar-width",Math.min(${SIDEBAR_MAX},w)+"px")}catch(e){}`

export function Document({ css, children }: PropsWithChildren<{ css: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>yaru</title>
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%235e6ad2'/%3E%3Ctext x='16' y='22' font-family='sans-serif' font-size='17' font-weight='600' text-anchor='middle' fill='white'%3Ey%3C/text%3E%3C/svg%3E"
        />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT }} />
      </head>
      <body class="h-screen overflow-hidden bg-canvas font-sans text-[13px] leading-normal text-ink antialiased scheme-dark">
        <div id="root">{children}</div>
        <script type="module" src="/assets/app.js" />
      </body>
    </html>
  )
}

export function BoardPage(props: BoardPageProps) {
  const initialState = { ...props, view: props.view ?? DEFAULT_VIEW }
  return (
    <>
      <div
        dangerouslySetInnerHTML={{ __html: renderToString(<ClientBoardPage {...initialState} />) }}
      />
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

function serialize(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}
