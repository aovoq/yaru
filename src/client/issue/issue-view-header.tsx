import { Button } from "../../components/button"
import { HeaderBar } from "../../components/header-bar"
import { IconButton } from "../../components/icon-button"
import { ChevronRightIcon } from "../../components/icons/chevron-right-icon"
import { CrossIcon } from "../../components/icons/cross-icon"
import { MoreIcon } from "../../components/icons/more-icon"
import { IssueId } from "../../components/issue-id"
import { Kbd } from "../../components/kbd"
import { TextLink } from "../../components/text-link"
import type { SaveState } from "../state"

// issue 画面の上端の帯。左に板へ戻るパンくず (Issues › #73 題名)、右に保存の様子 (新しい issue では作成のボタン)・issue のメニュー・閉じるボタンを置く
// 閉じるボタンは板へ戻るリンクなので、JavaScript が動かないときも閉じられる
// 保存に失敗して手元に保存していない変更が残っているとき (saveFailed) は、「Unsaved」に並べて保存をやり直すボタン (Retry) を出す
// 変更を打っている途中も手元の変更は残っているが、そのときは離れれば保存されるので Retry は出さない
// スマホの切り欠き (safe area) に帯の中身が重ならないよう、上に safe area の分の余白を足す。高さは中身の 48px のまま保つ (box-content)
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
  // 新しい issue ではまだ id が無いので空の文字列が来る
  issueId: string
  title: string
  boardHref: string
  saveState: SaveState
  draftDirty: boolean
  saveFailed: boolean
  onRetry: () => void
  // 押したメニューのボタン (anchor) の下に issue のメニューを開く
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
            {/* JavaScript が動かないときは自動保存されないので、保存のボタンを出す */}
            <noscript>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </noscript>
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
