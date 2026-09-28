import { useCallback, useEffect, useState } from "preact/hooks"

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 280
const SIDEBAR_COLLAPSE = 160
const DEFAULT_SIDEBAR_WIDTH = 224

export type SidebarPreference = {
  isOpen: boolean
  openSidebar: () => void
  closeSidebar: () => void
  startResize: (event: PointerEvent) => void
}

export function useSidebarPreference(): SidebarPreference {
  const [isOpen, setIsOpen] = useState(readSidebarOpen)
  const [width, setWidth] = useState(readSidebarWidth)

  useEffect(() => {
    if (isOpen) document.documentElement.removeAttribute("data-sidebar")
    else document.documentElement.setAttribute("data-sidebar", "closed")
    try {
      localStorage.setItem("yaru.sidebar.open", isOpen ? "1" : "0")
    } catch {}
  }, [isOpen])

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`)
    try {
      localStorage.setItem("yaru.sidebar.width", String(width))
    } catch {}
  }, [width])

  const openSidebar = useCallback(() => setIsOpen(true), [])
  const closeSidebar = useCallback(() => setIsOpen(false), [])
  const startResize = useCallback((event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    document.documentElement.setAttribute("data-resizing", "")
    const selection = window.getSelection()
    selection?.removeAllRanges()
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.clientX < SIDEBAR_COLLAPSE) {
        setIsOpen(false)
        return
      }
      setIsOpen(true)
      setWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(moveEvent.clientX))))
    }
    const onPointerUp = () => {
      document.documentElement.removeAttribute("data-resizing")
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
    }
    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
  }, [])

  return { isOpen, openSidebar, closeSidebar, startResize }
}

function readSidebarOpen(): boolean {
  if (typeof localStorage === "undefined") return true
  try {
    return localStorage.getItem("yaru.sidebar.open") !== "0"
  } catch {
    return true
  }
}

function readSidebarWidth(): number {
  if (typeof localStorage === "undefined") return DEFAULT_SIDEBAR_WIDTH
  try {
    const storedWidth = Number(localStorage.getItem("yaru.sidebar.width"))
    if (storedWidth >= SIDEBAR_MIN) return Math.min(SIDEBAR_MAX, storedWidth)
  } catch {}
  return DEFAULT_SIDEBAR_WIDTH
}
