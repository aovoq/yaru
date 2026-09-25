import { LOGO_LINK_CLASS, LOGO_MARK_CLASS, logoMarkMarkup } from "./logo"

// サーバーの画面 (dashboard・一覧) に置くロゴ。板の画面の src/client/icons.tsx と同じ SVG を埋め込む

export function LogoMark() {
  return (
    <span class="contents" dangerouslySetInnerHTML={{ __html: logoMarkMarkup(LOGO_MARK_CLASS) }} />
  )
}

// ホーム画面から開くとブラウザの戻るボタンが無いので、ロゴから全ワークスペースの一覧へ戻れるようにする
export function LogoLink() {
  return (
    <a
      href="/"
      aria-label="Projects"
      title="Projects"
      class={LOGO_LINK_CLASS}
      dangerouslySetInnerHTML={{ __html: logoMarkMarkup(LOGO_MARK_CLASS) }}
    />
  )
}
