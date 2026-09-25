import { Chip } from "../../components/chip"
import { GroupLabel } from "../../components/group-label"
import { DEFAULT_ISSUE_DISPLAY, type IssueDisplay } from "../../issue-order"
import { pageHref, type PageFilters } from "../view-model"

// Display の面の中身。issue のまとまり (group)・並べ方 (sort)・終わった issue の見せ方 (completed) の選択肢を並べる
// 見せ方は URL に持つので、選ぶ項目はリンクにする。板は同じ URL の中のリンクを読み直さずに開くので、面を開いたまま結果を見比べられる
// 完了と取りやめの列を開いているときは、サーバーが終わった issue を全て見せる (page.ts) ので、終わった issue の見せ方は出さない
// 開閉 (display-menu.tsx) と分けておき、CSS の見本 (css.tsx) で開いた姿をそのまま描けるようにする

const OPTIONS: {
  [Key in keyof IssueDisplay]: {
    title: string
    choices: { value: IssueDisplay[Key]; text: string }[]
  }
} = {
  group: {
    title: "Grouping",
    choices: [
      { value: "status", text: "Status" },
      { value: "priority", text: "Priority" },
      { value: "label", text: "Label" },
      { value: "none", text: "None" },
    ],
  },
  sort: {
    title: "Ordering",
    choices: [
      { value: "priority", text: "Priority" },
      { value: "updated", text: "Updated" },
      { value: "created", text: "Created" },
      { value: "due", text: "Due date" },
    ],
  },
  completed: {
    title: "Completed issues",
    choices: [
      { value: "hide", text: "Hide" },
      { value: "recent", text: "Past 7 days" },
      { value: "all", text: "All" },
    ],
  },
}

export function DisplayOptions({ filters }: { filters: PageFilters }) {
  const finishedColumn = filters.status === "done" || filters.status === "canceled"
  const keys: (keyof IssueDisplay)[] = finishedColumn
    ? ["group", "sort"]
    : ["group", "sort", "completed"]
  return (
    <div class="flex flex-col gap-3 p-2 sm:w-64">
      {keys.map((key) => {
        const option = OPTIONS[key]
        const current = filters[key] ?? DEFAULT_ISSUE_DISPLAY[key]
        return (
          <div role="group" aria-label={option.title}>
            <GroupLabel class="mb-1.5">{option.title}</GroupLabel>
            <div class="flex flex-wrap gap-1">
              {option.choices.map((choice) => (
                <Chip
                  href={pageHref({ ...filters, [key]: choice.value })}
                  active={current === choice.value}
                >
                  {choice.text}
                </Chip>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
