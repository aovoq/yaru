import { render } from "preact"
import { App } from "./app"
import "./styles/app.css"

// インライン script は置かない (docs/spec/security.md)。開閉は描画の前に当てる (src/ui/document.tsx:13)
const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 280

function applySidebarPreference(): void {
  try {
    if (localStorage.getItem("yaru.sidebar.open") === "0") {
      document.documentElement.setAttribute("data-sidebar", "closed")
    }
    const width = Number(localStorage.getItem("yaru.sidebar.width"))
    if (width >= SIDEBAR_MIN_WIDTH) {
      document.documentElement.style.setProperty(
        "--sidebar-width",
        `${Math.min(SIDEBAR_MAX_WIDTH, width)}px`,
      )
    }
  } catch {
    // localStorage が読めないときは既定の開いた幅のままにする (src/ui/document.tsx:13)
  }
}

const root = document.getElementById("app")
if (root === null) {
  throw new Error("missing #app: expected an element with id app, actual null")
}
const applicationRoot: HTMLElement = root

function draw(): void {
  render(<App href={window.location.href} />, applicationRoot)
}

applySidebarPreference()
window.addEventListener("popstate", draw)
draw()
