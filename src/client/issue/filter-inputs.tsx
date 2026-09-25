import { DEFAULT_ISSUE_DISPLAY } from "../../issue-order"
import { DEFAULT_VIEW } from "../../page"
import type { PageFilters } from "../view-model"

// 板の絞り込みと見せ方 (並べ方・まとめ方・終わった issue の見せ方) を保ったまま戻れるよう、フォームの送信に今の値を載せる
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
      {filters.awaiting ? <input type="hidden" name="awaiting" value="1" /> : null}
      {filters.sort && filters.sort !== DEFAULT_ISSUE_DISPLAY.sort ? (
        <input type="hidden" name="sort" value={filters.sort} />
      ) : null}
      {filters.group && filters.group !== DEFAULT_ISSUE_DISPLAY.group ? (
        <input type="hidden" name="group" value={filters.group} />
      ) : null}
      {filters.completed && filters.completed !== DEFAULT_ISSUE_DISPLAY.completed ? (
        <input type="hidden" name="completed" value={filters.completed} />
      ) : null}
    </>
  )
}
