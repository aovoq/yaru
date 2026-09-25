import { useEffect, useRef } from "preact/hooks"

// 中身に合わせて高さを伸ばす textarea。題名は改行を入れず 1 行の文として扱う
// 高さは打ったとき、値が差し替わったとき (別の issue を開いたとき)、幅が変わったときに測り直す
// 幅が変わると折り返しの数が変わるので、測り直さないと広げたあとに下に隙間が残り、狭めたあとに字が切れる
// 高さを変えると同じ要素の大きさの知らせがもう一度届くので、幅が前と同じ知らせでは測り直さない。測り直すと知らせが止まらなくなる
// https://drafts.csswg.org/resize-observer/#resize-observer-interface
export function AutoGrowTextarea({
  singleLine = false,
  onInput,
  ...props
}: {
  singleLine?: boolean
  onInput: (event: Event) => void
  [attribute: string]: unknown
}) {
  const textarea = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (textarea.current) resize(textarea.current)
  }, [props.value])

  useEffect(() => {
    const element = textarea.current
    if (!element || typeof ResizeObserver === "undefined") return
    let lastWidth: number | null = null
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width === undefined || width === lastWidth) return
      lastWidth = width
      resize(element)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <textarea
      {...props}
      rows={1}
      ref={textarea}
      onInput={(event: Event) => {
        const element = event.currentTarget as HTMLTextAreaElement
        if (singleLine && element.value.includes("\n"))
          element.value = element.value.replace(/\n/g, " ")
        resize(element)
        onInput(event)
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (
          singleLine &&
          event.key === "Enter" &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.isComposing
        ) {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).blur()
        }
        const handler = props.onKeyDown as ((event: KeyboardEvent) => void) | undefined
        handler?.(event)
      }}
    />
  )
}

function resize(element: HTMLTextAreaElement): void {
  element.style.height = "auto"
  element.style.height = `${element.scrollHeight}px`
}
