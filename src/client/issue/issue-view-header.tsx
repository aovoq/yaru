import { Button } from "../../components/button"
import { HeaderBar } from "../../components/header-bar"
import { IconButton } from "../../components/icon-button"
import { ChevronRightIcon } from "../../components/icons/chevron-right-icon"
import { CrossIcon } from "../../components/icons/cross-icon"
import { Kbd } from "../../components/kbd"
import { TextLink } from "../../components/text-link"
import type { SaveState } from "../state"

// issue 画面の上端の帯。左に板へ戻るパンくず、右に保存の様子 (新しい issue では作成のボタン) と閉じるボタンを置く
// 閉じるボタンは板へ戻るリンクなので、JavaScript が動かないときも閉じられる

export function IssueViewHeader({
  issueId,
  boardHref,
  saveState,
  draftDirty,
}: {
  // 新しい issue ではまだ id が無いので空の文字列が来る
  issueId: string
  boardHref: string
  saveState: SaveState
  draftDirty: boolean
}) {
  const isNew = !issueId
  return (
    <HeaderBar gap={2}>
      <TextLink href={boardHref}>Issues</TextLink>
      <ChevronRightIcon />
      <span class="font-mono text-[12px] text-ink">{isNew ? "New issue" : `#${issueId}`}</span>
      <div class="ml-auto flex items-center gap-2">
        {isNew ? (
          <Button type="submit" variant="primary">
            Create issue
            <Kbd variant="on-primary">⌘⏎</Kbd>
          </Button>
        ) : (
          <>
            <span aria-live="polite" class="text-[11px] text-ink-tertiary">
              {saveState === "saving"
                ? "Saving…"
                : draftDirty
                  ? "Unsaved"
                  : saveState === "saved"
                    ? "Saved"
                    : ""}
            </span>
            {/* JavaScript が動かないときは自動保存されないので、保存のボタンを出す */}
            <noscript>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </noscript>
          </>
        )}
        <IconButton id="drawer-close" href={boardHref} label="Close (Esc)">
          <CrossIcon />
        </IconButton>
      </div>
    </HeaderBar>
  )
}
