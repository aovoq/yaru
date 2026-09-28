# yaru の Go 移行の計画と台帳

このファイルは司令塔 (Claude) だけが書き換える。作業するエージェントは読むだけ。

## 目標

- Go が API・データ・CLI・端末 (herdr) を受け持ち、Vite + Preact の SPA が画面を受け持つ形に、完全に切り替える
- `.yaru/` の形式と CLI の出力は今の TS 版と同じにする。今のワークスペースと yaru の skill はそのまま動く
- なくすもの: サーバーでの SSR (スクリプトが無くても Dashboard が見られること)
- 守り: 127.0.0.1 だけで待ち受け、tailscale serve を通し、Origin と Host を確かめる
- 端末は切り替えの合格条件に入れない。並行して作り、切り替えのあとに入れる

## 決めたこと (2026-09-28、ユーザーと合意)

- API の約束は Connect RPC (proto)。画面の型は proto から作る
- ブランチは main から切った `feat/change-go`。作業ごとに `feat/change-go-<作業名>` を herdr の worktree で切る
- 作業は grok (herdr の `--kind grok`、全部承認のモード + `.grok/config.toml` の拒否の決まり)。数の上限は無い
- レビューは Claude。取り込みは司令塔だけ
- ユーザーに確認を取るのは 3 か所: 段階 0 の約束を固めたとき、切り替えの直前、古い版を消す前
- Markdown は画面側で描く (今の `renderMarkdown` をそのまま使う)。API は生の Markdown を返す
- あとで決める: declscope の `qualify` を使うか (段階 0 の確認のときに決める)

## 段階

### 段階 0: 約束を固める

| id | 作業 | 成果物 | 状態 |
|---|---|---|---|
| P0-clock | 時刻を外から固定する口 `YARU_NOW` を TS 版に足す (テストから) | `src/` の変更とテスト | 試験 (grok 1 体) |
| P0-format | `.yaru/` の形式の仕様を書く | `docs/spec/yaru-format.md` | 未着手 |
| P0-data-golden | データの操作の golden を取る仕組みと golden | `spec/golden/data/` | P0-clock 待ち |
| P0-cli-golden | CLI の全コマンドの golden | `spec/golden/cli/` | P0-clock 待ち |
| P0-routes | 全部の入口の一覧と、SPA + Connect への対応 (RPC・server stream・静的) | `docs/spec/routes.md` と `proto/` の下書き | 未着手 |
| P0-ui | 全部の状態の画面のシナリオ (1280 と 390) | `spec/ui/` | 未着手 |
| P0-security | 守りの約束 | `docs/spec/security.md` | 未着手 |
| P0-layout | Go のフォルダの作り・go.mod・declscope と depguard の設定 | 司令塔が作る | 未着手 |

入口の一覧 (P0-routes) には、JSON の API だけでなく次を全部入れる: フォームの POST と redirect (回答・取り下げ・選択肢)、SSE とライブ更新、PWA の manifest とアイコン、フォントと静的ファイル、Inbox、404。

### 段階 1: 並列で作る (段階 0 の確認のあと)

Go のデータ (モジュールごと)、Go の CLI (コマンドのまとまりごと)、Go の API (RPC ごと)、端末と herdr、画面 (画面ごと)、配り方 (Nix と launchd)。

### 段階 2: 新旧を並べて確かめる

写したワークスペースで新旧を同時に動かし、同じ操作の列を流して `.yaru/` と API の返事の差を比べる。段階 0 の画面のシナリオを新しい版で全部通す。

### 段階 3: 切り替える

Nix と launchd の向き先を替える。古い `dist/yaru.js` は戻せるように残し、ユーザーの確認のあとで消す。

## 台帳

| 日時 | 出来事 |
|---|---|
| 2026-09-28 | `feat/change-go` を main (613a9e0) から作成。AGENTS.md に Go 移行の決まり、`.grok/config.toml` に拒否の決まりを追加 |
