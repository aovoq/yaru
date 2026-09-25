import { LogoMark } from "./icons/logo-mark"

// ホーム画面から開くとブラウザの戻るボタンが無いので、ロゴから全ワークスペースの一覧へ戻れるようにする
export function LogoLink({ class: className = "" }: { class?: string }) {
  return (
    <a
      href="/"
      aria-label="Projects"
      title="Projects"
      class={[
        "shrink-0 rounded-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus/50",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <LogoMark />
    </a>
  )
}
