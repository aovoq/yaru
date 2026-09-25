// コピーなど、結果が画面に出ない操作を終えたことを短く知らせる
export function Notice({ text }: { text: string }) {
  return (
    <p
      role="status"
      class="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-hairline-strong bg-surface-3 px-3 py-1.5 text-[12px] text-ink shadow-lg shadow-black/50"
    >
      {text}
    </p>
  )
}
