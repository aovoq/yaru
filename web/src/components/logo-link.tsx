import { HIT_AREA_ICON } from "./hit-area"
import { LogoMark } from "./icons/logo-mark"

// ホーム画面から開くとブラウザの戻るボタンが無いので、ロゴから全ワークスペースの一覧へ戻れるようにする
// ロゴは 20px しかないので、押せる範囲は見た目より広げる (hit-area.ts)
export function LogoLink({ class: className = "" }: { class?: string }) {
  return (
    <a
      href="/"
      aria-label="Projects"
      title="Projects"
      class={[
        `shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hover ${HIT_AREA_ICON}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <LogoMark />
    </a>
  )
}
