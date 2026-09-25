import { BoardPage as ClientBoardPage, type BoardPageProps } from "../client/app"
import { DEFAULT_VIEW } from "../page"

// サーバーで描く板の画面
// 板はサーバーで描いた HTML をブラウザで同じ部品が引き継ぐので、ブラウザに渡す初期状態も一緒に埋め込む

export function BoardPage(props: BoardPageProps) {
  const initialState = { ...props, view: props.view ?? DEFAULT_VIEW }
  return (
    <>
      <ClientBoardPage {...initialState} />
      <script
        id="yaru-initial-state"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: serialize(initialState) }}
      />
    </>
  )
}

// script 要素の中に埋めるので、本文に「</script>」があっても要素が閉じないよう < を逃がす
// https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
function serialize(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}
