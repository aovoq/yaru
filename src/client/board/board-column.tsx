import type { ComponentChildren } from "preact"
import { useEffect, useState } from "preact/hooks"
import { IconButton } from "../../components/icon-button"
import { PlusIcon } from "../../components/icons/plus-icon"
import { newIssueHref, statusLabel, type PageFilters } from "../view-model"
import { StatusHeading } from "./status-heading"

// 板の 1 つの状態の列。見出しと新規作成の +、カードを落とせる場所を持つ
// カードを載せている間だけ面を塗る (data-over)。どのカードを引きずっているかは板 (board-view.tsx) が持つ

export function BoardColumn({
  status,
  filters,
  count,
  draggingIssueId,
  onDropIssue,
  children,
}: {
  status: string
  filters: PageFilters
  count: number
  draggingIssueId: string | null
  onDropIssue: (issueId: string | null) => void
  children?: ComponentChildren
}) {
  const [over, setOver] = useState(false)

  // 引きずるのをやめたら (dragend)、列の外で終わっても塗りを消す
  useEffect(() => {
    if (!draggingIssueId) setOver(false)
  }, [draggingIssueId])

  return (
    <section
      data-status={status}
      data-over={over ? "" : undefined}
      onDragOver={(event: DragEvent) => {
        if (!draggingIssueId) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
        setOver(true)
      }}
      onDragLeave={(event: DragEvent) => {
        const relatedTarget = event.relatedTarget
        const currentTarget = event.currentTarget
        if (
          !(relatedTarget instanceof Node) ||
          !(currentTarget instanceof Node) ||
          !currentTarget.contains(relatedTarget)
        ) {
          setOver(false)
        }
      }}
      onDrop={(event: DragEvent) => {
        event.preventDefault()
        setOver(false)
        onDropIssue(event.dataTransfer?.getData("text/plain") || draggingIssueId)
      }}
      class="group flex h-full w-[300px] shrink-0 flex-col rounded-lg transition-colors data-[over]:bg-surface-1"
    >
      <StatusHeading status={status} count={count} class="shrink-0 px-2 py-2">
        <IconButton
          href={newIssueHref(filters, status)}
          label={`New ${statusLabel(status)} issue`}
          size="xs"
          class="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <PlusIcon />
        </IconButton>
      </StatusHeading>
      <div class="min-h-16 flex-1 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  )
}
