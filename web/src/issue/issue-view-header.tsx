import { Button } from "../components/button"
import { HeaderBar } from "../components/header-bar"
import { IconButton } from "../components/icon-button"
import { ChevronRightIcon } from "../components/icons/chevron-right-icon"
import { CrossIcon } from "../components/icons/cross-icon"
import { MoreIcon } from "../components/icons/more-icon"
import { IssueId } from "../components/issue-id"
import { Kbd } from "../components/kbd"
import { TextLink } from "../components/text-link"
import type { SaveState } from "./model"

// issue 画面の上端。左に板へ戻るパンくず、右に保存の様子・メニュー・閉じるボタン
// 保存に失敗して手元の変更が残っているときだけ Retry を出す。打っている途中は離れれば保存されるので出さない
// ⌘⏎ の表記はキーボードの無いスマホ幅では出さない

export function IssueViewHeader({
  issueId,
  title,
  boardHref,
  saveState,
  draftDirty,
  saveFailed,
  onRetry,
  onOpenMenu,
}: {
  issueId: string
  title: string
  boardHref: string
  saveState: SaveState
  draftDirty: boolean
  saveFailed: boolean
  onRetry: () => void
  onOpenMenu?: (anchor: HTMLElement) => void
}) {
  const isNew = !issueId
  return (
    <HeaderBar gap={2} class="box-content pt-safe">
      <TextLink href={boardHref} class="shrink-0">
        Issues
      </TextLink>
      <ChevronRightIcon />
      {isNew ? (
        <span class="text-small text-ink">New issue</span>
      ) : (
        <span class="flex min-w-0 items-center gap-2">
          <IssueId id={issueId} />
          <span class="hidden min-w-0 truncate text-small text-ink-subtle sm:block sm:max-w-[40ch]">
            {title}
          </span>
        </span>
      )}
      <div class="ml-auto flex shrink-0 items-center gap-2">
        {isNew ? (
          <Button type="submit" variant="primary">
            Create issue
            <span aria-hidden="true" class="hidden items-center gap-0.5 sm:inline-flex">
              <Kbd variant="on-primary">⌘</Kbd>
              <Kbd variant="on-primary">⏎</Kbd>
            </span>
          </Button>
        ) : (
          <>
            <span aria-live="polite" class="text-micro text-ink-tertiary">
              {saveState === "saving"
                ? "Saving…"
                : draftDirty
                  ? "Unsaved"
                  : saveState === "saved"
                    ? "Saved"
                    : ""}
            </span>
            {saveFailed && saveState !== "saving" ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
            {onOpenMenu ? (
              <IconButton
                label="Issue actions"
                aria-haspopup="menu"
                onClick={(event: MouseEvent) => onOpenMenu(event.currentTarget as HTMLElement)}
              >
                <MoreIcon />
              </IconButton>
            ) : null}
          </>
        )}
        <IconButton id="drawer-close" href={boardHref} label="Close (Esc)">
          <CrossIcon />
        </IconButton>
      </div>
    </HeaderBar>
  )
}
