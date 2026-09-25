import type { ComponentChildren } from "preact"
import { useEffect, useState } from "preact/hooks"
import { IconButton } from "../../components/icon-button"
import { PlusIcon } from "../../components/icons/plus-icon"
import { newIssueHref, type IssueSection, type PageFilters } from "../view-model"
import { GroupHeading } from "./group-heading"

// 板の 1 つのまとまりの列。見出しと、状態の列なら新規作成の + とカードを落とせる場所を持つ
// 列は面を一段塗って、隣の列との境と、カードの置ける範囲を見せる。カードを載せている間はさらに明るくする (data-over)
// どのカードを引きずっているかは板 (board-view.tsx) が持つ
// + は hover したときだけ出す。hover の無い指の端末では出す手段が無いので、常に見せる
// https://drafts.csswg.org/mediaqueries-4/#hover

export function BoardColumn({
  section,
  filters,
  labelColors,
  draggingIssueId,
  onDropIssue,
  children,
}: {
  section: IssueSection
  filters: PageFilters
  labelColors: Map<string, string>
  draggingIssueId: string | null
  onDropIssue: (issueId: string | null) => void
  children?: ComponentChildren
}) {
  const [over, setOver] = useState(false)
  const status = section.group === "status" ? section.value : null

  // 引きずるのをやめたら (dragend)、列の外で終わっても塗りを消す
  useEffect(() => {
    if (!draggingIssueId) setOver(false)
  }, [draggingIssueId])

  return (
    <section
      data-status={status ?? undefined}
      data-group={section.key}
      data-over={over ? "" : undefined}
      onDragOver={(event: DragEvent) => {
        if (!draggingIssueId || status === null) return
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
      class="group flex h-full w-[85vw] shrink-0 snap-start flex-col rounded-lg bg-surface-1 transition-colors data-[over]:bg-surface-2 sm:w-[272px]"
    >
      <GroupHeading section={section} labelColors={labelColors} class="shrink-0 px-3 py-2">
        {status !== null ? (
          <IconButton
            href={newIssueHref(filters, status)}
            label={`New ${section.title} issue`}
            size="xs"
            class="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <PlusIcon />
          </IconButton>
        ) : null}
      </GroupHeading>
      <div class="min-h-16 flex-1 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  )
}
