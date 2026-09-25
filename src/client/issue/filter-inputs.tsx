import { DEFAULT_VIEW } from "../../page"
import type { PageFilters } from "../view-model"

// 板の絞り込みを保ったまま戻れるよう、フォームの送信に今の絞り込みを載せる
// issue の保存では status が issue の属性と重なるので、絞り込みの status は filter_status で送る
export function FilterInputs({
  filters,
  commentForm = false,
}: {
  filters: PageFilters
  commentForm?: boolean
}) {
  return (
    <>
      {filters.query ? <input type="hidden" name="query" value={filters.query} /> : null}
      {filters.view && filters.view !== DEFAULT_VIEW ? (
        <input type="hidden" name="view" value={filters.view} />
      ) : null}
      {filters.status ? (
        <input
          type="hidden"
          name={commentForm ? "status" : "filter_status"}
          value={filters.status}
        />
      ) : null}
      {filters.assignee ? (
        <input
          type="hidden"
          name={commentForm ? "assignee" : "filter_assignee"}
          value={filters.assignee}
        />
      ) : null}
      {filters.label ? <input type="hidden" name="label" value={filters.label} /> : null}
    </>
  )
}
