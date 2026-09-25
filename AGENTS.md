# AGENTS

- Premature Optimization is the Root of All Evil
- 一切妥協をしないこと
- 一切忖度しないこと
- 常に日本語を利用すること
- 全角と半角の間には半角スペースを入れること
  - この規則はコード・コメント・ドキュメント・コミットメッセージにのみ適用すること
  - ユーザーへ表示するコンテンツ文言（クイズの問題文・解説文・選択肢、スポット名・説明文など）には適用せず、和欧間スペースを入れないこと
- 絵文字を使わないこと
- コメントは全て日本語
- ログメッセージは全て英語
- エラーメッセージは全て英語

## Git Commit

- 作業の区切りごとにこまめにコミットすること（ユーザーへの確認は不要）
- コミットメッセージに Co-Authored-By 行を含めないこと
- 同じ worktree で他の agent が複雑な動いている前提で、あなたが該当のセッションで触れたファイルだけを path 指定で `git add` すること
  - `git add .` / `git add -A` / `git add --all` / `git add -u` / `git commit -a` は使わないこと

### Git CommitMessage

- 変更履歴はコミットメッセージが唯一の記録なので丁寧に記載すること
- 1行目日本語の命令形で「〜する」という形で書くこと
- 自明でない変更は、本文に変更の背景・理由を日本語で追記すること

### Git Branch

- 指示がない限りブランチを切らないこと。 `main` のまま進める。
- ブランチを切る指示があったときは `herdr worktree create` を使うこと
  - `git switch -c` / `git checkout -b` / `git worktree add` は使わないこと
  - `HERDR_ENV` が 1 でないときはブランチを切らず、Herdr の外であることを伝えること
  - 使い方は `herdr worktree` で確認すること
  - ユーザーが切り替えを求めていない限り `--no-focus` を付けること
  - `--base` の指示がなければ `develop` にすること
- ブランチ名は次の prefix にすること
  - バグ修正は `feat/fix-`
  - 機能追加は `feat/add-`
  - 後方互換のない変更は `feat/change-`
- マージが済んだブランチは必ず `git branch -d` で消すこと。残さないこと
  - `-d` はマージ済みしか消さないので、ユーザーへの確認は不要
  - 未マージまで消す `-D` は使わないこと
  - `herdr worktree create` で切った場合は、先に `herdr worktree remove` してから `-d` すること
- リモート追跡の残骸は `git fetch --prune` で畳むこと

## yaru

- Linear が複雑なので作った、local で動く小さな Linear。
- 後方互換性は考慮しないこと
- 一時的な修正はしないこと
- 変数名を省略しないこと
- 何か変更をする場合はテストを先に修正すること
- コメントは全て日本語
  - 末尾コメントを利用しないこと
  - RFC ドキュメントへのリンクを必ず記載すること
  - RFC ドキュメントからの引用は英語をそのまま記載すること
- エラーメッセージは全て英語
  - 小文字で始めること
  - 末尾にピリオドをつけないこと
  - 具体的な情報を含めること
  - 期待値と実際の値を示すこと
  - 技術的だが簡潔にすること

## 構成

- CLI (`src/index.ts`) と、1 つの `yaru serve` が全ワークスペースを配る Web (`src/web.tsx`) からなる
  - `/` にワークスペースの一覧、`/p/<名前>/` に各ワークスペースの板、`/p/<名前>/dashboard` に質問と進み具合
  - ワークスペースは CLI が開くたびに `~/.local/state/yaru/workspaces.json` へ自動で登録される
- git の worktree の中では、元のフォルダ (main worktree) の `.yaru` を読み書きする
- 質問 (`.yaru/questions/`) は git に入れない。issue とコメントは git で管理する
- 画面は全て Preact で描く。URL の振り分けと API は Hono が受け持つ
  - サーバーでは `preact-render-to-string` で HTML を作る (`renderDocument` in `src/ui.tsx`)。板 (`src/client/`) はブラウザで同じ部品が引き継いで動かす
  - JSX の読み込み先は `tsconfig.json` の `jsxImportSource: "preact"` で決める。hono/jsx は使わない

## 変更したあと

- `bun run fmt`、`bun run typecheck`、`bun test` を全て通すこと
- 使われている `yaru` は `dist/yaru.js` なので、変更を反映するには必ず次の 2 つを行うこと
  - `bun run build`
  - `launchctl kickstart -k gui/$(id -u)/com.aovoq.yaru-serve` (常駐の `yaru serve` は画面のスクリプトを起動中ずっと持ち続けるため)
- 常駐の設定は `~/dotfiles/home/modules/yaru.nix` にある。スマホからは Tailscale (`tailscale serve`) 経由で開く。`funnel` で公開しないこと
- 同じリポジトリで他のエージェントも作業しているので、コミットの前に `git log` と `git diff` で自分の変更だけかを確かめること

## テスト

- CLI は起動した場所のワークスペースを本物の登録ファイルへ書くので、CLI を動かすテストは `YARU_STATE_DIR` を一時ディレクトリに向けること
- 本物の `.yaru` (AsukaTravel など) で動作を確かめないこと。写したワークスペースと別のポート (`yaru serve -p 47811`) を使う
- 画面の確認はデスクトップ幅とスマホ幅 (390px) の両方で行うこと
  - 撮影は `agent-browser` を使う。ego-browser の screenshot は止まることがある
  - `input` と `change` のように、実際のブラウザが続けて出すイベントも試すこと

## 画面の決まり

- 部品の置き場所
  - 複数の画面で使う部品は `src/components/` に置く (Button・Markdown・Section・EmptyState・QuestionCard・IssueLinkList・アイコンなど)
  - 1 つの画面だけの部品は、その画面のフォルダに置く (`src/client/board/`、`src/client/issue/`、`src/dashboard/`)
  - 画面の入口のファイル (`src/client/app.tsx`、`src/client/issue-view.tsx`、`src/dashboard.tsx`) は、状態と部品をつなぐ組み立てだけにする
  - barrel (index) のファイルは作らず、定義しているファイルから直接読み込む
- ボタンは `Button` か `buttonClass` を使い、クラスを直接並べない。本文は `Markdown` を通す
- 同じ役割の部品を画面ごとに作らない。見た目が少し違うだけなら、共通の部品に props を足す

- Tailwind のクラスは `src/css.tsx` の見本を描いた HTML から拾う。新しい画面や、操作したあとにしか出ない部品 (メニュー、知らせ、編集中の欄など) を足したら、見本にも描き足すこと
- Markdown の描画結果にはクラスを付けられないので、見た目は `src/css.tsx` の `.markdown` に書く
- 本文は必ず `renderMarkdown` を通して描くこと。生の HTML を通さず、リンクと画像は安全なスキームだけに限っている。本文はエージェントが外から取ってきた文章を含み、画面から質問に答えられるため
- 属性は変えたとき、文字の欄は離れたときに、その項目だけを自動保存する。読み直すときは手元で変えた項目だけを残す (`src/client/state.ts`)
