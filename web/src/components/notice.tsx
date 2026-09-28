// コピーなど、結果が画面に出ない操作を終えたことを短く知らせる
// 知らせが無いときも live region (外側の div) は置いたままにして、中の吹き出しだけを出し入れする
// 読み上げは、あとから差し込まれた live region の最初の中身を読まないことがあるため
// 外側を隠す (visibility: hidden や display: none) と読み上げの木から外れてしまうので、外側は見た目を持たない枠にする
// https://www.w3.org/TR/wai-aria-1.2/#status
export function Notice({ text }: { text: string | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      class="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2"
    >
      {text ? (
        <p class="text-small rounded-md border border-hairline-strong bg-surface-3 px-3 py-1.5 whitespace-nowrap text-ink shadow-lg shadow-black/50">
          {text}
        </p>
      ) : null}
    </div>
  )
}
