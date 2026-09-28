import { CenteredMessage } from "./centered-message"
import { TextLink } from "./text-link"

// 見つからないときなどに、理由と戻り先へのリンクだけを画面の真ん中に出す。src/ui/error-view.tsx

export function ErrorView({ message, backHref = "/" }: { message: string; backHref?: string }) {
  return (
    <main class="grid h-dvh place-items-center px-4 pt-safe pb-safe">
      <CenteredMessage icon="×">
        <p class="text-body text-ink-muted">{message}</p>
        <TextLink href={backHref} tone="primary" size="xs">
          back
        </TextLink>
      </CenteredMessage>
    </main>
  )
}
