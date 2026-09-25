import { render } from "preact"
import { BoardPage, type BoardPageProps } from "./app"
import { readReturnedDrafts, withoutReturnedParams } from "./state"

const initialState = document.getElementById("yaru-initial-state")

if (!initialState) {
  throw new Error("initial state element mismatch: expected #yaru-initial-state, actual missing")
}

const root = document.getElementById("root")
if (!root) {
  throw new Error("render target mismatch: expected #root, actual missing")
}

const page = JSON.parse(initialState.textContent || "") as BoardPageProps

// コメントや回答のフォームが失敗して戻されたときの書きかけの文を読み、URL からは落とす
// 誤り (?error=) はサーバーが既に page.error に入れている。URL に残すと、読み直すたびに同じ誤りと文が出直す
const returnedDrafts = readReturnedDrafts(window.location.search)
const cleaned = withoutReturnedParams(window.location.href)
if (cleaned !== null) window.history.replaceState(null, "", cleaned)

// 消えた issue へのリンクで開いたときは、板と誤りが返る。id を残すと読み直すたびに誤りが出直すので落とす
const url = new URL(window.location.href)
if (page.current === null && url.searchParams.has("id")) {
  url.searchParams.delete("id")
  window.history.replaceState(null, "", url)
}

render(<BoardPage {...page} returnedDrafts={returnedDrafts} />, root)
