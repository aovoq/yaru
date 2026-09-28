import { useEffect, useId, useRef } from "preact/hooks"
import { Button } from "./button"
import { Dialog } from "./dialog"

// 取り返しのつかない操作の前に、続けるかを聞く小さな面 (「Discard changes?」など)
// ブラウザの window.confirm は見た目がそろわず、画面の Esc や ⌘⏎ の決まりとも合わないので、画面の中に出す
// 既定の focus は取り消しの側 (cancel) に置く。Enter の押し間違いで書いたものを捨てないため
// https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  title: string
  description?: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const descriptionId = useId()
  const actions = useRef<HTMLDivElement | null>(null)
  // autofocus は後から差し込んだ要素では効かない (ページで 1 度だけ処理される) ので、描いたあとに focus を置く
  // https://html.spec.whatwg.org/multipage/interaction.html#the-autofocus-attribute
  useEffect(() => {
    actions.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus()
  }, [])
  return (
    <Dialog
      label={title}
      role="alertdialog"
      describedBy={description ? descriptionId : undefined}
      onClose={onCancel}
      class="max-w-sm p-4"
    >
      <h2 class="text-title m-0 font-semibold text-ink">{title}</h2>
      {description ? (
        <p id={descriptionId} class="text-body mt-1.5 mb-0 text-ink-subtle">
          {description}
        </p>
      ) : null}
      <div ref={actions} class="mt-4 flex justify-end gap-2">
        <Button data-cancel="" type="button" variant="secondary" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
