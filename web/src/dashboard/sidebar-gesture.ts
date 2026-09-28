// サイドバーの開閉と幅。板と鍵をそろえる。src/ui/live-page.ts:253-294、src/main.tsx

export const SIDEBAR_MIN_WIDTH = 160
export const SIDEBAR_MAX_WIDTH = 280

export function setSidebarOpen(open: boolean): void {
  const root = document.documentElement
  if (open) root.removeAttribute("data-sidebar")
  else root.setAttribute("data-sidebar", "closed")
  try {
    localStorage.setItem("yaru.sidebar.open", open ? "1" : "0")
  } catch {
    // localStorage が書けないときは、この画面の開閉だけを変える
  }
}

export function startSidebarResize(event: { button: number; preventDefault: () => void }): void {
  if (event.button !== 0) return
  event.preventDefault()
  const root = document.documentElement
  root.setAttribute("data-resizing", "")
  const onMove = (move: PointerEvent) => {
    if (move.clientX < SIDEBAR_MIN_WIDTH) {
      setSidebarOpen(false)
      return
    }
    setSidebarOpen(true)
    const width = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(move.clientX)))
    root.style.setProperty("--sidebar-width", `${width}px`)
    try {
      localStorage.setItem("yaru.sidebar.width", String(width))
    } catch {
      // 幅を覚えられなくても、この画面では変えた幅のままにする
    }
  }
  const onUp = () => {
    root.removeAttribute("data-resizing")
    document.removeEventListener("pointermove", onMove)
    document.removeEventListener("pointerup", onUp)
  }
  document.addEventListener("pointermove", onMove)
  document.addEventListener("pointerup", onUp)
}
