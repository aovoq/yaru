import { CenteredMessage } from "../components/centered-message"
import { AllIcon } from "../components/icons/all-icon"
import { SearchIconLarge } from "../components/icons/search-icon-large"
import { Kbd } from "../components/kbd"
import { TextLink } from "../components/text-link"
import { pageHref, type PageFilters } from "./view-model"

// 表示する issue が 1 件も無いときに板の場所へ出す案内
// 絞り込みで 0 件なら外す道を、終わった issue を隠しているだけなら全て見せる道を、そもそも 0 件なら作り方を見せる
// 終わった issue は既定で 7 日より前のものを隠すので、終わったものしか無いワークスペースを空と言ってしまわないようにする
// 絞り込みを外しても、ワークスペース (basePath) と表示の設定 (板か一覧か、まとまり・並べ方・終わった issue の見せ方) は残す
// components/empty-state.tsx の点線の枠とは違い、画面の真ん中にアイコンと導線を置く

export function EmptyBoard({
  filters,
  totalIssueCount,
}: {
  filters: PageFilters
  totalIssueCount: number
}) {
  const filtered = Boolean(
    filters.query || filters.status || filters.assignee || filters.label || filters.awaiting,
  )
  if (!filtered && totalIssueCount > 0) {
    return (
      <main id="board" class="grid min-h-0 flex-1 place-items-center">
        <CenteredMessage icon={<AllIcon />}>
          <div class="text-body font-medium text-ink">No open issues</div>
          <TextLink href={pageHref({ ...filters, completed: "all" })} tone="primary" size="xs">
            Show completed issues
          </TextLink>
        </CenteredMessage>
      </main>
    )
  }
  return (
    <main id="board" class="grid min-h-0 flex-1 place-items-center">
      <CenteredMessage icon={filtered ? <SearchIconLarge /> : <AllIcon />}>
        <div class="text-body font-medium text-ink">
          {filtered ? "No matching issues" : "No issues yet"}
        </div>
        {filtered ? (
          <TextLink
            href={pageHref({
              view: filters.view,
              sort: filters.sort,
              group: filters.group,
              completed: filters.completed,
              basePath: filters.basePath,
            })}
            tone="primary"
            size="xs"
          >
            Clear filters
          </TextLink>
        ) : (
          <div class="text-small text-ink-tertiary">
            Press <Kbd>C</Kbd> or click New issue to create one
          </div>
        )}
      </CenteredMessage>
    </main>
  )
}
