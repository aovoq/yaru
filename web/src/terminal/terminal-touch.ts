import {
  type Gesture,
  INERTIA_STOP,
  advanceScroll,
  beginGesture,
  decayVelocity,
  endGesture,
  moveGesture,
} from "./terminal-logic"

// 縦ドラッグはホイールに、横の速い払いはタブ移動にする。画面端では何もしない
// ~/workspace/resident-app/web/src/Terminal.tsx:128-221

export function attachTerminalTouch(
  host: HTMLElement,
  hooks: {
    viewportWidth: () => number
    rowHeight: () => number
    emitWheel: (lines: number, clientX: number, clientY: number) => void
    sendSequence: (sequence: string) => void
    showHint: (hint: string) => void
  },
): () => void {
  let gesture: Gesture | undefined
  let inertia = 0

  const onStart = (event: TouchEvent) => {
    cancelAnimationFrame(inertia)
    const touch = event.touches[0]
    if (!touch) {
      gesture = undefined
      return
    }
    gesture = beginGesture(
      { clientX: touch.clientX, clientY: touch.clientY, timeStamp: event.timeStamp },
      event.touches.length,
      hooks.viewportWidth(),
    )
  }

  const onMove = (event: TouchEvent) => {
    if (!gesture || event.touches.length !== 1) return
    const touch = event.touches[0]
    if (!touch) return
    const moved = moveGesture(gesture, {
      clientX: touch.clientX,
      clientY: touch.clientY,
      timeStamp: event.timeStamp,
    })
    gesture = moved.gesture
    if (!moved.capture) return
    event.preventDefault()
    event.stopPropagation()
    const scrolled = advanceScroll(gesture.accumulator, moved.stepY, hooks.rowHeight())
    gesture = { ...gesture, accumulator: scrolled.accumulator }
    if (scrolled.wheelLines !== 0) {
      hooks.emitWheel(scrolled.wheelLines, touch.clientX, touch.clientY)
    }
  }

  const onEnd = (event: TouchEvent) => {
    const active = gesture
    const touch = event.changedTouches[0]
    const ended = endGesture(
      active,
      touch
        ? { clientX: touch.clientX, clientY: touch.clientY, timeStamp: event.timeStamp }
        : undefined,
    )
    if (ended.kind === "inertia" && active && touch) {
      let velocity = ended.velocity
      let last = performance.now()
      const tick = (now: number) => {
        const elapsed = now - last
        last = now
        velocity = decayVelocity(velocity, elapsed)
        if (Math.abs(velocity) < INERTIA_STOP || gesture !== active) return
        const scrolled = advanceScroll(active.accumulator, velocity * elapsed, hooks.rowHeight())
        active.accumulator = scrolled.accumulator
        if (scrolled.wheelLines !== 0) {
          hooks.emitWheel(scrolled.wheelLines, touch.clientX, touch.clientY)
        }
        inertia = requestAnimationFrame(tick)
      }
      inertia = requestAnimationFrame(tick)
      return
    }
    gesture = undefined
    if (ended.kind !== "swipe") return
    hooks.sendSequence(ended.sequence)
    hooks.showHint(ended.hint)
  }

  const onCancel = () => {
    gesture = undefined
  }

  host.addEventListener("touchstart", onStart, { capture: true, passive: true })
  host.addEventListener("touchmove", onMove, { capture: true, passive: false })
  host.addEventListener("touchend", onEnd, { capture: true, passive: true })
  host.addEventListener("touchcancel", onCancel, { capture: true, passive: true })
  return () => {
    cancelAnimationFrame(inertia)
    host.removeEventListener("touchstart", onStart, { capture: true })
    host.removeEventListener("touchmove", onMove, { capture: true })
    host.removeEventListener("touchend", onEnd, { capture: true })
    host.removeEventListener("touchcancel", onCancel, { capture: true })
  }
}
