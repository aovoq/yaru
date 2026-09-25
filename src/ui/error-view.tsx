import { CenteredMessage } from "../components/centered-message"
import { TextLink } from "../components/text-link"

// ワークスペースが見つからないときなどに、理由と一覧 (/) へ戻るリンクだけを画面の真ん中に出す

export function ErrorView({ message }: { message: string }) {
  return (
    <main class="grid h-screen place-items-center">
      <CenteredMessage icon="×">
        <p class="text-[13px] text-ink-muted">{message}</p>
        <TextLink href="/" tone="primary" size="xs">
          back
        </TextLink>
      </CenteredMessage>
    </main>
  )
}
