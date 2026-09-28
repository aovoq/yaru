import { CheckIcon } from "../components/icons/check-icon"
import { useIssueActions } from "./context-menu/issue-actions"

// 板の行とカードに重ねる、まとめて選ぶ印。押すと x と同じく issue をまとめた選択に足す・外す
// 行とカードは a なので、印はその外 (兄弟) に置く。リンクの中に押せるものを入れ子にすると、押したときに issue も開いてしまう
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element
// マウスでは行に乗ったときだけ出し、何かを選んでいる間と、hover の無い端末 (指) ではいつも出す
// キーボードでは x で選べるので、行ごとに Tab の止まる場所を増やさないよう tabindex="-1" にする
// 押せる範囲は 28px の四角にし、見た目の枠は 14px にする。指では 44px まで広げる (HIT_AREA_ICON_TOUCH と同じ広げ方)

export function BulkCheckbox({ issueId, class: extra = "" }: { issueId: string; class?: string }) {
  const { bulkSelection, toggleBulkSelection } = useIssueActions()
  const checked = bulkSelection.includes(issueId)
  const visibility =
    bulkSelection.length > 0
      ? "opacity-100"
      : "opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked ? "true" : "false"}
      aria-label={`Select #${issueId}`}
      title={checked ? `Deselect #${issueId} (x)` : `Select #${issueId} (x)`}
      tabIndex={-1}
      data-bulk-checkbox=""
      onClick={(event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        toggleBulkSelection(issueId)
      }}
      class={`group/check absolute z-[1] grid size-7 place-items-center rounded-sm transition-opacity after:absolute pointer-coarse:after:-inset-2 ${visibility} ${extra}`}
    >
      <span class="grid size-4 place-items-center rounded-xs border border-hairline-strong bg-surface-1 group-aria-checked/check:border-primary group-aria-checked/check:bg-primary">
        <span class="invisible grid place-items-center group-aria-checked/check:visible">
          <CheckIcon />
        </span>
      </span>
    </button>
  )
}
