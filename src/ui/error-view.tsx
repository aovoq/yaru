import { CenteredMessage } from "../components/centered-message"
import { TextLink } from "../components/text-link"

// ワークスペースが見つからないときなどに、理由と戻り先へのリンクだけを画面の真ん中に出す
// ワークスペースの中で起きたときは、一覧 (/) まで戻らずにそのワークスペースの板へ戻す (backHref)

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
