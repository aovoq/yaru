import { CenteredMessage } from "../../components/centered-message"
import { AllIcon } from "../../components/icons/all-icon"
import { SearchIconLarge } from "../../components/icons/search-icon-large"
import { Kbd } from "../../components/kbd"
import { TextLink } from "../../components/text-link"
import { pageHref, type PageFilters } from "../view-model"

// 表示する issue が 1 件も無いときに板の場所へ出す案内
// 絞り込みで 0 件なら外す道を、そもそも 0 件なら作り方を見せる
// components/empty-state.tsx の点線の枠とは違い、画面の真ん中にアイコンと導線を置く

export function EmptyBoard({ filters }: { filters: PageFilters }) {
  const filtered = Boolean(filters.query || filters.status || filters.assignee || filters.label)
  return (
    <main id="board" class="grid min-h-0 flex-1 place-items-center">
      <CenteredMessage icon={filtered ? <SearchIconLarge /> : <AllIcon />}>
        <div class="text-[13px] font-medium text-ink">
          {filtered ? "No matching issues" : "No issues yet"}
        </div>
        {filtered ? (
          <TextLink href={pageHref({ view: filters.view })} tone="primary" size="xs">
            Clear filters
          </TextLink>
        ) : (
          <div class="text-xs text-ink-tertiary">
            Press <Kbd>C</Kbd> or click New issue to create one
          </div>
        )}
      </CenteredMessage>
    </main>
  )
}
