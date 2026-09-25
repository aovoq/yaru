// 中身に合わせて高さを伸ばす textarea。題名は改行を入れず 1 行の文として扱う
export function AutoGrowTextarea({
  singleLine = false,
  onInput,
  ...props
}: {
  singleLine?: boolean
  onInput: (event: Event) => void
  [attribute: string]: unknown
}) {
  const resize = (element: HTMLTextAreaElement) => {
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }
  return (
    <textarea
      {...props}
      rows={1}
      ref={(element: HTMLTextAreaElement | null) => {
        if (element) requestAnimationFrame(() => resize(element))
      }}
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
