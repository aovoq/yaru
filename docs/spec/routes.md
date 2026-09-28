# yaru serve の入口

段階 0 の P0-routes。Go 移行で API と画面の経路を作るときの正解にする。計画は `docs/migration/PLAN.md` (このファイルは司令塔だけが書き換える)。

推測で埋めていない。根拠は `ファイル:行`。コメントとコードが違うときはコードを書き、差は「未決」に置く。ここは今の TS 版の入口を写したもので、形式や出力をよくする変更は決めていない。

proto の下書きは `docs/spec/proto-draft/` にある。`proto/` ではない。

## 読み方

本番の `yaru serve` は `serve` が `createServerApp` を `127.0.0.1` で待ち受ける (`src/web.tsx:611-622`、`src/index.ts:350-356`)。

入口は 2 段ある。

| 段             | 関数                                  | 役割                                                            |
| -------------- | ------------------------------------- | --------------------------------------------------------------- |
| サーバー       | `createServerApp` (`src/web.tsx:479`) | 一覧、受信箱、静的ファイル、`/p/<slug>/` への振り分け           |
| ワークスペース | `createApp` (`src/web.tsx:69`)        | 1 つのワークスペースの板、dashboard、質問、issue、コメント、SSE |

`/p/<slug>/...` は接頭辞を外した URL で、そのワークスペースの `createApp` に渡す (`src/web.tsx:563-586`)。`createApp` 自身は接頭辞を知らない。リンクを作るときだけ `basePath` (例: `/p/app`) を使う (`src/web.tsx:478`)。

テストは `createApp` を接頭辞なし (`basePath` が `""`) でも呼ぶ。以下の「ワークスペース内の path」はその内側の path である。本番の path は、その前に `/p/<slug>` が付く。例外は、サーバー段にだけある path (`/`、`/inbox`、`/api/inbox`) と、両段に登録してある静的ファイルである。

`slug` は登録時にフォルダ名から `[A-Za-z0-9._-]` 以外を `-` に潰し、空なら `workspace`、重複には `-2` から添える (`src/workspaces.ts:74-76`、`src/workspaces.ts:28-31`)。照合は登録の `slug` と path パラメータの完全一致 (`src/workspaces.ts:49-50`)。

HEAD は、対応する GET を実行してから本文を捨てる (Hono `hono-base.js:279-281`)。GET として書いた入口は HEAD でも同じ status と header になる。`GET /events` の監視開始は `ReadableStream` の構築時なので (`src/web.tsx:307`)、HEAD でも questions ディレクトリを作るところまで入る。

GET でも POST でもない method は 405 にしない。登録が無ければ notFound の 404 になる。`POST /` と `OPTIONS /events` を一時ディレクトリで叩くと、どちらも 404 で `text/html; charset=UTF-8` だった。

## 共通

### 待ち受け

| 項目                 | 値                                                                                          | 根拠                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| hostname             | `127.0.0.1` だけ                                                                            | `src/web.tsx:616`                                         |
| port                 | 既定 `47800`。`--port` か `-p`                                                              | `src/web.tsx:45`、`src/index.ts:789-792`                  |
| アイドルタイムアウト | `0` (切らない)。リクエストごとにも `0`                                                      | `src/web.tsx:617-619`                                     |
| 既に port が使用中   | 終了コードを変えず、`yaru  already running  http://127.0.0.1:<port>` を stdout に出して戻る | `src/web.tsx:625-629`。テストは `src/web.test.ts:309-323` |
| 起動ログ             | `yaru  http://127.0.0.1:<port>`                                                             | `src/web.tsx:623`                                         |

Origin と Host の検査は、このサーバーには無い。計画の「守り」は P0-security の成果物であり、ここでは決めない。

起動時、カレントディレクトリがワークスペースなら `workspaces.json` へ登録する。ワークスペースでなければ無視する (`src/index.ts:352-355`、`src/workspaces.ts:24-38`)。これは HTTP の入口ではない。

### エラーの status

ワークスペースアプリの `onError` (`src/web.tsx:83-96`)。

| 条件                                  | `/api/` で始まる path       | それ以外                  |
| ------------------------------------- | --------------------------- | ------------------------- |
| `QuestionConflictError`               | 409、`{"error","question"}` | 409 の HTML (`ErrorView`) |
| `Error.message` に `not found` を含む | 404、`{"error"}`            | 404 の HTML               |
| それ以外                              | 400、`{"error"}`            | 400 の HTML               |

`error` は `Error.message`。Error でなければ `String(err)` (`src/web.tsx:773-775`)。

この分岐はエラーの種類ではなく、メッセージ文字列の部分一致である。`question not found: 1` も `issue not found: 9` も 404 になる (`src/web.test.ts:330-334`)。質問の衝突だけが型で 409 になる。

フォームの POST (回答・取り下げ・取り消し・コメント) は、この `onError` に乗せず、自分で捕まえて 303 の redirect にする。衝突でも 409 にはならない。`onError` の 409 HTML に入る経路は、ソース上は見つかっていない (フォームは全て catch する。`src/web.tsx:149-157`、`184-188`、`203-215`)。

壊れた JSON は Hono が `JSON.parse` し (`node_modules/hono/dist/request.js:114-115`)、その例外が `onError` に入る。`not found` を含まないので 400 と `{"error": <JSON.parse の message>}`。Bun で `{` を送ると message は `JSON Parse error: Expected '}'` だった。この文はランタイム依存なので、Go の文としては写さない (未決)。

`c.json` の Content-Type は `application/json` (Hono `context.js:379`)。`c.html` は `text/html; charset=UTF-8` (`context.js:383`)。

ワークスペースアプリの notFound (`src/web.tsx:98-101`): path が `/api/` で始まれば 404 の `{"error":"not found"}`。そうでなければ 404 の HTML。HTML の戻りリンクは、そのワークスペースの板 (`basePath/`、`src/web.tsx:72-76`)。title は `pageTitle("Error")` なので `Error · yaru` (`src/ui/page-title.ts:4`、`src/web.tsx:75`)。

サーバーアプリの notFound (`src/web.tsx:493-500`) は、path に関係なく 404 の HTML。戻りリンクは `/` (`src/ui/error-view.tsx:7`)。したがって本番の `/api/nope` は JSON ではなく HTML の 404 である (一時ディレクトリで確認した)。`/p/<slug>/api/nope` はワークスペースアプリに渡るので JSON の 404 である。

未知のワークスペースは、`/p/<slug>/` 以降だけが 404 で、本文に `workspace not found: <slug>` を含む (`src/web.tsx:565-573`、`src/server.test.ts:108-110`)。`/p/<slug>` (末尾スラッシュなし) は存在を見ずに 302 で `/p/<slug>/` へ飛ばす (`src/web.tsx:561`)。query は付けない。`/p/missing` は 302、その先の `/p/missing/` が 404 になる (一時ディレクトリで確認した)。

### HTML の共通

画面の HTML は `<!DOCTYPE html>` に続けて `renderDocument` が作る (`src/ui/render-document.tsx:12-16`)。`lang="ja"` (`src/ui/document.tsx:30`)。

head に常にあるもの (`src/ui/document.tsx:31-54`):

- viewport `width=device-width, initial-scale=1, viewport-fit=cover`
- title (`pageTitle`)
- font の preload (`/assets/inter-4.1.woff2`、`crossorigin="anonymous"`)
- manifest `/manifest.webmanifest`
- icon `/icon.svg`、apple touch `/apple-touch-icon.png`
- theme-color `#010102`
- `mobile-web-app-capable`、`apple-mobile-web-app-title=yaru`、`apple-mobile-web-app-status-bar-style=black`
- CSS は別 URL ではなく `<style>` にインライン (`src/ui/document.tsx:53`)
- サイドバーの開閉を描く前に当てる inline script

`script` を渡した画面 (dashboard、inbox、プロジェクト一覧) はその inline script だけで、`/assets/app.js` を読まない (`src/ui/document.tsx:59-63`)。板は `src="/assets/app.js"` を読む。

CSS の `@font-face` も同じ font URL を指す (`src/css.tsx:121-127`)。

### フォームの戻り先

回答・取り下げ・取り消しが受け付ける `returnTo` は、次の 3 つだけ (`src/web.tsx:674-691`)。

- `<basePath>/` (板)
- `<basePath>/dashboard`
- `/inbox`

`/` で始まらないもの、`//` で始まるもの、`\` を含むもの、別オリジン、上以外の path は `<basePath>/dashboard` に落とす。query は残し、`returnTo` に付いていた hash は捨てて、サーバーが新しい fragment を付ける (`src/web.tsx:691`、`src/web.tsx:695-701`)。

別ワークスペースの板への `returnTo` は無視される (`src/server.test.ts:84-91`)。

redirect は 303 See Other (`src/web.tsx:128-131` が理由を書いている。RFC 9110 section 15.4.4)。例外は `POST /issues` の成功だけで、status を渡さないので Hono の既定 302 になる (`src/web.tsx:299`、Hono `context.d.ts:430`、テスト `src/web.test.ts:225`)。

失敗したとき query に載せるもの:

| 名前        | 意味                                                  |
| ----------- | ----------------------------------------------------- |
| `error`     | `Error.message`                                       |
| `q`         | 質問 id                                               |
| `answer`    | 書きかけの回答。長いときは載せない                    |
| `comment`   | 書きかけのコメント。コメントのフォームだけ            |
| `workspace` | 戻り先が `/inbox` のときだけ、ワークスペースの slug   |
| `answered`  | 答えられた質問 id。dashboard と `/inbox` への成功だけ |

空文字は query に載せない (`src/web.tsx:697-699`)。

書きかけを載せるのは、`encodeURIComponent` した長さが 8000 以下のときだけ (`src/web.tsx:753-760`)。超えたら `error` だけを載せ、書きかけは捨てる。コメントは、ブラウザの戻るで欄に残っている、という前提 (`src/web.tsx:753-755`)。テストは `src/web.test.ts:366-377`。

`/inbox` の fragment は `q-<slug>-<id>` (`src/inbox.ts:59-60`)。それ以外は `q-<id>` (`src/web.tsx:724-726`)。

`next` は答えたあとに開く fragment。`/^[A-Za-z][A-Za-z0-9._-]*$/` に合うときだけ使い、合わなければ答えたカードの fragment に戻す (`src/web.tsx:745-750`)。コメントは「カードの id (`q-<名前>-<番号>`) だけ」と書くが、正規表現はそれより広い。`proceeded` も通る (`src/dashboard.test.tsx:443` がフォームに `next=proceeded` を出している)。コードの正規表現を正とする。差は未決。

答えた直後の取り消し (`answered`) を載せるのは、戻り先が dashboard か `/inbox` のときだけ (`src/web.tsx:739-743`)。板は載さない (`src/web.tsx:160`)。

### 書くファイル

`store.dir` は `<ワークスペース>/.yaru` (`src/store.ts:161-164`)。

| 操作                           | 書く場所                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| issue の保存                   | `.yaru/issues/<id>.md` (`src/store.ts:767-768`)。追跡する属性が変われば `.yaru/events/<id>.jsonl` に追記 (`src/issue-events.ts:50-62`、`src/issue-events.ts:82-83`) |
| blocks の相手側                | 相手の `.yaru/issues/<id>.md` と、その events (`src/store.ts:631-644`)                                                                                              |
| コメント                       | `.yaru/comments/<id>.md`。ディレクトリが無ければ作る (`src/store.ts:686`、`src/store.ts:721-722`)                                                                   |
| 質問の回答・取り消し・取り下げ | `.yaru/questions/<id>.md` (`src/questions.ts:609-610`)                                                                                                              |
| 期限切れのあとの回答           | 上に加え、issue へコメントを 1 件足す (`src/questions.ts:231-240`)                                                                                                  |
| `GET /events` の開始           | `.yaru/questions/` と、中の `.gitignore` (`*\n`) が無ければ作る (`src/web.tsx:321-324`、`src/questions.ts:601-606`)。質問が 1 件も無くても作る                      |

画面からの issue 保存は provenance を渡さない。session、worktree、branch は前の値のまま (`src/store.ts:46`、`src/store.ts:291-293`)。`answeredBy` とイベントの `by` は `git config user.name`。空なら `me` (`src/store.ts:463-466`)。

質問の作成、acknowledge、期限通知の印は、この HTTP には入口が無い。CLI と、serve の通知ループがファイルを書く。

## 入口の一覧

本番の path。ワークスペース内と書いた行は `/p/<slug>` を外した内側の path も同じ動きをする。

| method | 本番の path                         | 内側         | 成功時                    |
| ------ | ----------------------------------- | ------------ | ------------------------- |
| GET    | `/`                                 | サーバー     | 200 HTML プロジェクト一覧 |
| GET    | `/inbox`                            | サーバー     | 200 HTML 受信箱           |
| GET    | `/api/inbox`                        | サーバー     | 200 JSON                  |
| GET    | `/assets/app.js`                    | 両段         | 200 JavaScript            |
| GET    | `/manifest.webmanifest`             | 両段         | 200 manifest              |
| GET    | `/icon.svg`                         | 両段         | 200 SVG                   |
| GET    | `/apple-touch-icon.png`             | 両段         | 200 PNG 180               |
| GET    | `/icon-192.png`                     | 両段         | 200 PNG 192               |
| GET    | `/icon-512.png`                     | 両段         | 200 PNG 512               |
| GET    | `/icon-maskable-512.png`            | 両段         | 200 PNG 512               |
| GET    | `/assets/inter-4.1.woff2`           | 両段         | 200 woff2                 |
| GET    | `/p/:slug`                          | サーバー     | 302、query は捨てる       |
| GET    | `/p/:slug/`                         | `/`          | 200 か 404 の HTML (板)   |
| GET    | `/p/:slug/dashboard`                | `/dashboard` | 200 HTML                  |
| POST   | `/p/:slug/questions/:id/answer`     | 同左         | 303                       |
| POST   | `/p/:slug/questions/:id/undo`       | 同左         | 303                       |
| POST   | `/p/:slug/questions/:id/cancel`     | 同左         | 303                       |
| GET    | `/p/:slug/api/questions`            | 同左         | 200 JSON                  |
| GET    | `/p/:slug/api/questions/:id`        | 同左         | 200 JSON                  |
| POST   | `/p/:slug/api/questions/:id/answer` | 同左         | 200 JSON                  |
| POST   | `/p/:slug/api/questions/:id/cancel` | 同左         | 200 JSON                  |
| POST   | `/p/:slug/issues`                   | 同左         | 302、失敗は 400 HTML      |
| GET    | `/p/:slug/events`                   | 同左         | 200 SSE                   |
| GET    | `/p/:slug/api/issues`               | 同左         | 200 JSON 配列             |
| GET    | `/p/:slug/api/page`                 | 同左         | 200 か 404 の JSON        |
| GET    | `/p/:slug/api/issues/:id`           | 同左         | 200 JSON                  |
| POST   | `/p/:slug/api/issues`               | 同左         | 200 JSON                  |
| GET    | `/p/:slug/api/comments`             | 同左         | 200 JSON 配列             |
| POST   | `/p/:slug/api/comments`             | 同左         | 200 JSON                  |
| POST   | `/p/:slug/comments`                 | 同左         | 303                       |

静的ファイルはワークスペースアプリにも登録してある (`src/web.tsx:248-250` と `src/web.tsx:553-555`)。本番では `/icon.svg` も `/p/<slug>/icon.svg` も届く。画面の link は常にルートの path である (`src/ui/document.tsx:37-46`)。

Service Worker の route は無い。置かない、と書いてある (`src/pwa.ts:8`)。`assets/fonts/LICENSE.txt` を配る route も無い。

## 各入口

### GET `/` プロジェクト一覧

`src/web.tsx:502-504`、中身は `src/web.tsx:592-608`。

- query も body も見ない。
- 200、`text/html; charset=UTF-8`。title は `yaru` (`src/server.test.ts:237`)。
- 登録のうち `.yaru/config.yml` がまだあるワークスペースを、登録順に出す (`src/workspaces.ts:43-46`)。各カードは slug、フォルダの絶対 path、答え待ちの質問 (status が `open` か `expired`)、`in_progress` の件数 (`src/web.tsx:594-603`、`src/projects/project-card.tsx:35-36`)。
- 副作用はファイルを書かない。各ワークスペースの質問と issue を読む。
- inline script は 30 秒後に `location.reload()` (`src/projects.tsx:43-45`)。`/assets/app.js` は読まない。
- 呼び出し元は、ブラウザが `/` を開いたとき。ホーム画面の manifest の `start_url` も `/` (`src/pwa.ts:30`)。
- ワークスペースが 0 件でも 200。本文は `No workspaces yet...` (`src/projects.tsx:30`)。

### GET `/inbox` 受信箱

`src/web.tsx:508-551`。定数 `INBOX_PATH` は `/inbox` (`src/inbox-page.tsx:20`)。

query:

| 名前        | 扱い                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------ |
| `workspace` | 失敗の戻り、または `answered` と組む slug                                                  |
| `q`         | 失敗した質問 id                                                                            |
| `error`     | 失敗の理由。該当カードがまだ答え待ちならその中、無ければ画面の上 (`src/inbox-page.tsx:64`) |
| `answer`    | 書きかけ                                                                                   |
| `answered`  | 取り消しの知らせを出す質問。`workspace` と両方あるときだけ読む (`src/web.tsx:511-516`)     |

body は無い。200 HTML。title は `Inbox · yaru` (`src/server.test.ts:176`)。

`readInbox` は全部のワークスペースの `open` と `expired` を混ぜ、blocking、dueSoon、noDeadline、proceeded に分ける (`src/inbox.ts:36-55`、`src/questions.ts:432-444`)。答え済みと取り下げは入れない (`questionRank` が 4 のときグループキーが無い。`src/questions.ts:447-453`)。

`answered` の質問が読めなければ知らせは出さない (`src/web.tsx:461-467`)。

副作用は書かない。inline script は 30 秒ごとに `GET /api/inbox` を見る (`src/web.tsx:540-546`、`src/ui/live-page.ts:188-201`)。間隔は 30000 (`src/web.tsx:48`)。全ワークスペースのファイル監視は重いので poll にしている (`src/web.tsx:47`)。

呼び出し元は一覧の Inbox リンク (`src/server.test.ts:238`) と、回答フォームの `returnTo=/inbox`。

### GET `/api/inbox`

`src/web.tsx:557-559`。query も body も見ない。200、`application/json`。

```json
{
  "groups": { "blocking": [], "dueSoon": [], "noDeadline": [], "proceeded": [] },
  "workspaces": [{ "slug": "", "basePath": "/p/<slug>", "awaiting": 0 }]
}
```

各 item は `workspace`、`basePath`、`href` (`<basePath>/dashboard#q-<id>`)、`anchor` (`q-<slug>-<id>`)、`question` (`src/inbox.ts:13-22`、`src/inbox.ts:46-52`)。テストは `src/server.test.ts:120-151`。

呼び出し元:

- inbox の poll (`src/ui/live-page.ts:193`)
- 板のワークスペース切り替え。開いたときに 1 回。`basePath` が空の単独アプリは呼ばない (`src/client/board/workspace-switcher.tsx:15`、`src/client/board/workspace-switcher.tsx:28-34`)
- コマンドパレット。開いたときに 1 回。失敗は無視 (`src/client/command-palette/command-palette.tsx:44-49`)

`href` と `basePath` は slug から決まる。質問の中身は `Question` の JSON。

### GET `/p/:slug/` と GET `/` (板の HTML)

内側は `src/web.tsx:103-109`。`boardPageData` (`src/web.tsx:707-717`) が `getPageData` (`src/page.ts:93-151`) を呼ぶ。

query (板の URL と、`GET /api/page` が同じものを読む):

| 名前                                                 | 扱い                                                                                                                | 根拠                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `query`                                              | 部分一致。空は絞らない                                                                                              | `src/page.ts:94`、`src/store.ts:375-379`           |
| `id`                                                 | 開く issue。`new` は下書き。無い issue は current を null にして error                                              | `src/page.ts:163-182`                              |
| `status`                                             | issue の status。不正な値は例外                                                                                     | `src/store.ts:431-436`                             |
| `assignee`                                           | 文字列一致。`me` は git の名前、`none` と空は担当なし                                                               | `src/store.ts:202`、`src/store.ts:407-410`         |
| `label`                                              | そのラベルを含む                                                                                                    | `src/store.ts:374`                                 |
| `awaiting`                                           | `1` のときだけ、答え待ちの質問がある issue に絞る。他の値は絞らない                                                 | `src/page.ts:99`                                   |
| `sort`                                               | `priority` `updated` `created` `due`。空は `priority`。それ以外は 400                                               | `src/issue-order.ts:37-38`、`src/issue-order.ts:8` |
| `group`                                              | `status` `priority` `label` `none`。空は `status`                                                                   | `src/issue-order.ts:41-42`                         |
| `completed`                                          | `hide` `recent` `all`。空は `recent`。`status` が `done` か `canceled` のときは URL が何でも応答の display は `all` | `src/page.ts:103-109`                              |
| `view`                                               | `board` だけ board。それ以外は `list`                                                                               | `src/page.ts:50-51`                                |
| `new_status` `new_parent` `new_label` `new_assignee` | `id=new` の下書きの初期値。`new_assignee` の `me` と `none` は上と同じ読み替え                                      | `src/page.ts:164-174`、`src/page.ts:187-191`       |
| `error`                                              | これが有れば、issue が無いときの error より優先して `PageData.error` に入れる                                       | `src/web.tsx:715-716`                              |

`comment`、`q`、`answer` はサーバーの PageData には入らない。板のクライアントが URL から読む (`src/client/state.ts:233-244`)。

body は無い。

応答は HTML。status は、`id` が有って error が `issue not found: <id>` のときだけ 404。それ以外は 200 (`src/web.tsx:714-716`)。404 でも板の HTML は返す (`src/web.test.ts:380-390`)。title は、issue を開いていれば `#<id> <title> · <slug> · yaru`、そうでなければ `<slug> · yaru` (`src/web.tsx:77-80`、`src/server.test.ts:249`)。接頭辞が空のテストでは slug が title に入らない。

HTML には描画済みの板と、同じ props の JSON を `<script id="yaru-initial-state" type="application/json">` に埋める (`src/ui/board-page.tsx:7-17`)。`<` は `\u003c` に逃がす (`src/ui/board-page.tsx:23-24`)。クライアントはこれを読んで引き継ぐ (`src/client/main.tsx:5-31`)。

`PageData` のフィールドは `src/page.ts:63-91`。JSON にするとき `undefined` のキーは落ちる。`error` が無いときキーは無い。`questions` は常に配列 (issue を開いていなければ `[]`)。

開いている issue の `commits` は、id が数字のときだけ git で探す。数字でなければ空 (`src/page.ts:135-138`)。`commitsForIssue` は数字以外を渡すと例外だが、ここは呼ばない。

副作用は `.yaru` を書かない。読むものは issue、コメント、質問、events、git の名前、数字 id のとき issue のコミット、stale の設定。

呼び出し元:

- ブラウザが板を開く。検索欄は JS が無いとき GET の form (`src/client/board/search-box.tsx:55-64`)
- 一覧の Issues リンク (`src/projects/project-card.tsx:52`)
- 通知の issue URL (`src/notify.ts:45-46`)
- 保存やコメントの redirect

不正な `sort` などの例外は、HTML なら 400 の ErrorView、`/api/page` なら 400 の JSON。`sort=nope` の `/api/page` は `invalid sort: expected priority, updated, created, or due, actual "nope"` だった。

### GET `/p/:slug/dashboard`

`src/web.tsx:113-126`、描画は `src/web.tsx:423-458`。

query は `q`、`error`、`answer`、`answered`。inbox と違い `workspace` は見ない (1 ワークスペースの画面だから)。`answered` の質問が無ければ知らせは出さない。

200 HTML。title は `Dashboard · <slug> · yaru` (`src/server.test.ts:248`)。

埋め込むデータ (`src/dashboard.tsx:35-52`):

- 質問を全部 (`listQuestions` のフィルタなし。status は読んだ時刻で `expired` を決める)
- issue を全部 (`listIssues` のフィルタなし。並びは `updatedAt` の新しい順。板の sort ではない。`src/store.ts:208`)
- `readSessionHealth` (Claude Code のログ。`~/.claude/projects/...`。`src/sessions.ts:87-88`)。窓は 7 日 (`src/sessions.ts:50`)
- `readRepositoryState`。git でなければ null (`src/repository.ts:26-27`)
- 上の query から作った `returned` と `answered`

副作用は書かない。セッションログと git を読む。

inline script は `EventSource(<basePath>/events)` と、変化のたびに `GET <basePath>/api/questions` (`src/web.tsx:448-453`、`src/ui/live-page.ts:174-186`)。入力中でなければ `location.reload()`。

呼び出し元はサイドバー、モバイルのリンク、一覧の Dashboard ボタン、通知の質問 URL (`src/notify.ts:40-41` は `/p/<slug>/dashboard#q-<id>`)。

この画面の JSON API は無い。質問一覧の API は dashboard の一部でしかない。

### POST `/questions/:id/answer` (フォーム)

`src/web.tsx:132-169`。常に 303。JSON は返さない。

body は `application/x-www-form-urlencoded` (画面の form は enctype を付けない)。`parseBody` の値が文字列でなければ空文字として扱う (`src/web.tsx:777-778`)。

| フィールド       | 意味                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body`           | 回答本文。選択肢ボタンは、その選択肢を `body` の値にする (`src/components/question-card.tsx:125-126`)                                                                                                                       |
| `useDefault`     | `"1"` のとき、保存する本文は `Go with the default action: ` に `defaultAction` (無ければ空) を足したもの。redirect に戻す書きかけは、この展開前の `body` (`src/web.tsx:140-143`、`src/dashboard.tsx:60`、`src/web.tsx:137`) |
| `expectedStatus` | 描いたときの status。空は渡さない。`answered` なら答えの置き換えとみなす (`src/questions.ts:198-204`)                                                                                                                       |
| `force`          | `"1"` のとき、答え済みを置き換える。画面のフォームは出していない。JSON API は `true` だけを見る                                                                                                                             |
| `returnTo`       | 上の許可リスト                                                                                                                                                                                                              |
| `next`           | 次の fragment                                                                                                                                                                                                               |

成功時の Location:

- dashboard か `/inbox` へ戻るとき、`answered=<id>` と、inbox なら `workspace=<slug>`。fragment は `next` か、答えたカード
- 板へ戻るとき query は足さない。fragment だけ

既定の戻り先 (returnTo が無い、または拒否) は dashboard。テストは `src/server.test.ts:71-81` (`/p/AsukaTravel/dashboard?answered=1#q-1`)。

失敗も 303。`error`、`q`、inbox なら `workspace`、書きかけ `answer`。not found でも 404 にはしない。

書くファイルは質問の md。期限が切れたあとの回答で issue が付いていれば、コメントも 1 件 (`src/questions.ts:231-240`)。

呼び出し元は `QuestionAnswerForm` と、カードの Answer、Use default、選択肢 (`src/components/question-answer-form.tsx:35-52`、`src/components/question-card.tsx:118-181`)。issue 画面、dashboard、inbox の 3 つが同じフォームを使う。JS が動いていても回答は fetch せず、この POST のままである (板の issue 保存やコメントとは違う)。

### POST `/questions/:id/undo` (フォーム)

`src/web.tsx:173-194`。JSON の対になる API は無い。

| フィールド   | 意味                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `answeredAt` | 取り消したい答えの時刻。空は渡さない。現在の `answeredAt` と違えば衝突 (`src/questions.ts:276-280`) |
| `returnTo`   | 上と同じ                                                                                            |

成功は 303。query は `q` と、inbox なら `workspace` と、人が打った回答だけを `answer` に戻す。Use default の接頭辞で始まる回答と、選択肢と完全一致する回答は欄に戻さない (`src/web.tsx:732-737`)。

失敗は 303 で `error` と `q`。書きかけは載せない。

断る条件は `src/questions.ts:269-298`。エージェントが acknowledge 済み、30 秒超過 (`src/questions.ts:247`)、期限後の回答でコメントに写したあと、status が answered でない、`answeredAt` の不一致。30 秒超過は `QuestionConflictError` ではないので、もし `onError` に乗れば 400 だが、フォームは 303 にする。

呼び出し元は dashboard と inbox の Undo (`src/components/answer-undo-toast.tsx:45-52`)。板はトーストを出さないので、この POST を描かない。

### POST `/questions/:id/cancel` (フォーム)

`src/web.tsx:196-218`。body は `returnTo`、`expectedStatus` (サーバーは読まない)、`next`。

成功は 303。query は足さず、fragment は `next` かそのカード。失敗は 303 で `error` と `q`。

答え済みは衝突 (`src/questions.ts:333-337`)。すでに canceled なら何も書かず成功と同じ redirect (`src/questions.ts:332`)。

画面は期限切れの Dismiss (`src/components/question-card.tsx:157-165`)。フォームは expired のときだけ描く (`src/components/question-answer-form.tsx:53-62`)。

### GET `/api/questions`

`src/web.tsx:220-227`。

query は `status` と `issue`。空は渡さない。`status` は `open` `expired` `answered` `canceled` (`src/questions.ts:494-498`)。不正なら 400。

200 は `{"questions":[...]}`。配列を裸で返さない (issue 一覧と違う)。並びは `compareQuestions` (`src/questions.ts:389`)。

呼び出し元は dashboard の live script (`src/ui/live-page.ts:178`)。フィルタなしで取り、`open` と `expired` をクライアントで数える。

### GET `/api/questions/:id`

`src/web.tsx:229-231`。200 は `Question` オブジェクトそのもの。包まない。無い id は 404 の `{"error":"question not found: <id>"}`。

画面は呼んでいない。`answered` のトーストは HTML を描くときにサーバーが読む。

### POST `/api/questions/:id/answer`

`src/web.tsx:233-242`。JSON body。

| フィールド       | 扱い                                                               |
| ---------------- | ------------------------------------------------------------------ |
| `body`           | そのまま `answerQuestion` へ。フォームと違い `useDefault` は見ない |
| `expectedStatus` | あれば文字列のまま。空文字も渡る (フォームは空を落とす)            |
| `force`          | `true` のときだけ true。`"1"` や `1` は false                      |

成功は 200 で `Question`。衝突は 409 で `{"error","question"}` (`src/web.test.ts:713-731`)。本文が空なら 400 (`src/questions.ts:215-218`)。無い id は 404。

画面は呼んでいない。フォームの POST が画面の経路。

### POST `/api/questions/:id/cancel`

`src/web.tsx:244-246`。body は見ない。200 で `Question`。答え済みは 409。無い id は 404 (`src/web.test.ts:761-772`)。すでに canceled なら 200 で、ファイルは書き換えない。

画面は呼んでいない。

### POST `/issues` (フォーム)

`src/web.tsx:252-300`。

絞り込みは query が空でない方を優先し、空なら body を使う (`src/web.tsx:254-263`)。

| body の名前                                                         | 意味                                                                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `query` `view` `label` `awaiting` `sort` `group` `completed`        | 戻る URL の絞り込み                                                                                             |
| `filter_status` `filter_assignee`                                   | 絞り込み。issue 自身の `status` と `assignee` とぶつからないように別名 (`src/client/issue/filter-inputs.tsx:6`) |
| `id`                                                                | あれば更新、無ければ作成                                                                                        |
| `title` `body`                                                      | キーが body に有るときだけ保存対象                                                                              |
| `status` `assignee` `labels` `dueDate` `priority` `parent` `blocks` | キーが有るときだけ。`labels` と `blocks` はカンマ区切りの 1 文字列 (`src/web.tsx:788-798`)                      |

画面が実際に name を付けているのは `id`、`title`、`body`、編集中だけの `dueDate`、絞り込みの隠し欄 (`src/client/issue-view.tsx:157`、`src/client/issue/description.tsx:69`、`src/client/issue/due-date-value.tsx:34`)。status や labels はボタンで、JS の `POST /api/issues` に載せる。JS が無い form POST では、開いていない属性はキーが無く、保存対象に入らない。

成功は 302 で `<basePath>/` に絞り込み query を付けた URL (`src/web.tsx:299`、`src/web.tsx:664-671`)。`id` は Location に付かない。

失敗は redirect しない。400 の HTML で、板を同じ絞り込みで描き、`current` を送られた下書きで置き、`error` を載せる (`src/web.tsx:279-297`)。title が空の作成は `title is required when creating an issue` (`src/web.test.ts:138-150`)。

呼び出し元は issue 画面の form (`src/client/issue-view.tsx:147-155`)。JS が動くときは `preventDefault` して `POST /api/issues` に回す (`src/client/issue-view.tsx:151-154`、`src/client/use-page-controller.ts:299-304`)。

### GET `/events`

`src/web.tsx:302-355`。query も body も見ない。

200。header は `content-type: text/event-stream; charset=utf-8`、`cache-control: no-cache`、`connection: keep-alive`。

最初に `: connected\n\n`。その後、ファイルの変化で `data: change\n\n`。5 秒ごとに `: ping\n\n` (`src/web.tsx:313-331`)。`data` は常に `change` だけで、どのファイルかは載らない。

監視するのは `.yaru/issues` (開けなければ `.yaru` を再帰)、`.yaru/questions`、存在すれば `.yaru/comments` (`src/web.tsx:315-330`)。`events/` は直接は見ない。issue 保存は issue ファイルも書くので、その変化で届く。comments ディレクトリが接続時に無いと、その接続ではコメントを見ない。

クライアントが切ると watcher と ping を止める (`src/web.tsx:332-346`)。

呼び出し元:

- 板。`onmessage` で 80ms 待ってから `GET /api/page` を今の URL の query で取り直す (`src/client/use-page-controller.ts:88-94`)
- dashboard の inline script (`src/ui/live-page.ts:175`)

inbox とプロジェクト一覧は、この SSE を使わない。

### GET `/api/issues`

`src/web.tsx:357-367`。200 は `Issue` の JSON 配列。`{"issues":...}` では包まない。

query は `status`、`assignee`、`label`、`query`、`due`。`due` は `overdue` のときだけ絞る。他の値は無視 (`src/web.tsx:364`)。`awaiting`、`sort`、`group`、`completed`、`view` は見ない。並びは `updatedAt` の新しい順で、板の sort ではない (`src/store.ts:208`)。

`parent` フィルタは `listIssues` にあるが、この入口は渡さない (`src/store.ts:62-68` と `src/web.tsx:359-365`)。

画面は呼んでいない。CLI の `hintBoard` は個別 GET の方を呼ぶ。

### GET `/api/page`

`src/web.tsx:370-373`。query は板の HTML と同じ。body は無い。

200 か 404 の `PageData` JSON。無い issue のときも `issues` などを含んだ 404 で、`error` は `issue not found: <id>`、`current` は null (`src/web.test.ts:340-348`)。クライアントは、404 でも `issues` が配列なら成功として読む (`src/client/use-page-controller.ts:311-316`)。

呼び出し元は板の遷移、戻る、SSE のあとの読み直し (`src/client/use-page-controller.ts:63`)。`cache: no-store`。

### GET `/api/issues/:id`

`src/web.tsx:375-377`。200 は `Issue`。無い id は 404 の `{"error"}` (`src/web.test.ts:330-334`)。

画面は呼んでいない。CLI が保存のあと、serve が居れば 200ms 以内にここを叩き、200 なら板の URL を stdout に出す (`src/index.ts:730-740`)。失敗は無視する。

### POST `/api/issues`

`src/web.tsx:379-382`。JSON を `SaveInput` として `saveIssue` に渡す (`src/store.ts:79-95`)。

キーが無いフィールドは変えない (`title !== undefined` など。`src/store.ts:266-289`)。proto ではこの「キーが無い」を残す必要がある (未決の null の節)。

| フィールド                                                                         | 扱い                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                               | 無しなら作成。作成には空でない `title` が要る                                                                                                                                                             |
| `title` `status` `assignee` `labels` `dueDate` `priority` `parent` `blocks` `body` | 部分更新。`labels` と `blocks` は文字列の配列 (フォームのカンマ区切りとは違う)                                                                                                                            |
| `assignee` `dueDate` `priority` `parent`                                           | `""` と `none` は null。`assignee` の `me` は git の名前 (`src/store.ts:399-410`)                                                                                                                         |
| `addBlocks` `removeBlocks` `addBlockedBy` `removeBlockedBy`                        | `blocks` の代わりの差分。`blocks` と同時は 400 (`src/store.ts:541-544`)。画面は `blocks` の全置換を送る (`src/client/issue-view.tsx:96-98`)                                                               |
| `patch`                                                                            | 本文への操作の配列。`body` と同時は不可。新規には不可 (`src/store.ts:259-260`)。操作の形は `src/store.ts:71-77`。1 件から 50 件 (`src/store.ts:884-885`)。フィールド名は `old_string` のように snake_case |

成功は 200 の `Issue`。検証エラーは 400 の `{"error"}`。無い id の更新は 404。

画面が送るもの (`src/client/use-page-controller.ts:325-337` と、属性だけの部分更新 `src/client/use-page-controller.ts:178`):

- 新規と、開いている issue のまとめて保存は、id、title、status、assignee、labels、dueDate、priority、parent、blocks、body
- 属性 1 つは `{id, そのフィールド}`
- 列の移動は `{id, status}`
- 相手の blocked by は、相手 id に `{blocks: 配列}`

4xx は送り直さない。5xx と通信失敗は下書きを残して送り直す (`src/client/use-page-controller.ts:294-308`)。

### GET `/api/comments`

`src/web.tsx:384-388`。query の `issue` が空なら 400 で `issue is required when listing comments`。issue が無ければ 404 (`getIssue` が `issue not found`)。

200 は `Comment` の配列。古い順 (`src/store.ts:647-651`)。画面は呼んでいない。板は `GET /api/page` の `comments` を使う。

### POST `/api/comments`

`src/web.tsx:390-392`。JSON を `saveComment` に渡す (`src/store.ts:97-102`)。

| フィールド | 扱い                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------- |
| `id`       | 有ればそのコメントの本文を更新。画面は送らない                                            |
| `issue`    | 新規のとき。`parent` が有れば親の issue を使い、`issue` は見ない (`src/store.ts:677-678`) |
| `parent`   | 返信。画面のフォームは送らない。CLI は送れる (`src/index.ts:537`)                         |
| `body`     | 空や空白だけは 400                                                                        |

成功は 200 の `Comment`。`author` は git の名前。

画面は、JS があるときここを `{issue, body}` で呼ぶ (`src/client/issue/use-comment-posting.ts:38-42`)。

### POST `/comments` (フォーム)

`src/web.tsx:395-418`。常に 303。失敗しても HTML の 400 にはしない (issue フォームと違う)。

body は `issue`、`parent`、`body` と、絞り込みの `query` `status` `assignee` `label` `awaiting` `sort` `group` `completed` `view`。絞り込みの status は、こちらでは別名にしない (`src/client/issue/filter-inputs.tsx:20-25`)。

成功すると `id` を保存されたコメントの issue にする。失敗すると、body の `issue` か、親コメントの issue を `id` にし、`error` と、長さの上限内なら `comment` を載せる (`src/web.test.ts:785-800`)。

Location は `<basePath>/?<絞り込み>&id=<issue>`。fragment は付かない。

呼び出し元は `#comment-form` (`src/client/issue-view.tsx:287-300`)。JS があるときは preventDefault して API の方へ送る。

### 静的ファイル

`registerPwaRoutes` (`src/pwa.ts:43-52`) と `registerFontRoutes` (`src/font.ts:10-16`)。

| path                      | status | Content-Type                     | Cache-Control                         | 中身                                                                                    |
| ------------------------- | ------ | -------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| `/manifest.webmanifest`   | 200    | `application/manifest+json`      | 付けない                              | 下の JSON                                                                               |
| `/icon.svg`               | 200    | `image/svg+xml`                  | 付けない                              | `logoSvg("rounded")` (`src/logo.ts:20-26`)                                              |
| `/apple-touch-icon.png`   | 200    | `image/png`                      | 付けない                              | 180 の正方形。manifest の icons には入っていない                                        |
| `/icon-192.png`           | 200    | `image/png`                      | 付けない                              | 192                                                                                     |
| `/icon-512.png`           | 200    | `image/png`                      | 付けない                              | 512                                                                                     |
| `/icon-maskable-512.png`  | 200    | `image/png`                      | 付けない                              | 512、purpose は maskable                                                                |
| `/assets/app.js`          | 200    | `text/javascript; charset=utf-8` | `no-cache`                            | 板のクライアントをその場で bundle (`src/web.tsx:470-474`、`src/client-script.ts:10-21`) |
| `/assets/inter-4.1.woff2` | 200    | `font/woff2`                     | `public, max-age=31536000, immutable` | `assets/fonts/InterVariable.woff2` をそのまま (`src/font.ts:6-15`)                      |

manifest (`src/pwa.ts:26-41`):

```json
{
  "name": "yaru",
  "short_name": "yaru",
  "description": "Local issues. Markdown in .yaru.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#010102",
  "theme_color": "#010102",
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    {
      "src": "/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

`/assets/app.js` は板の `main.tsx` だけである。dashboard と inbox と一覧のスクリプトは HTML にインラインで、このファイルには入らない。

### GET `/p/:slug`

`src/web.tsx:561`。302、Location は `/p/<slug>/`。query も hash も残さない。ワークスペースが無くても 302。テストは末尾スラッシュありの存在確認だけが 404 を見ている (`src/server.test.ts:101-106`)。

### どの route にも当たらない path

サーバー段は HTML の 404。ワークスペース段は、内側の path が `/api/` なら JSON の 404、そうでなければ HTML の 404。

未知ワークスペースの `/p/<slug>/...` は、内側へ渡す前に HTML の 404 (`workspace not found: <slug>`)。

## 画面の操作と入口

JS が動く板 (`src/client/`) と、スクリプトが無くても送れるフォームが混ざっている。

| 操作                                       | 今の呼び方                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| 板の中の移動、検索、戻る                   | `GET /api/page` + `history` (`src/client/use-page-controller.ts:58-86`) |
| 板の自動更新                               | `EventSource /events` のあと `GET /api/page`                            |
| issue の作成、属性、本文、列の移動         | `POST /api/issues`。JS が無ければ `POST /issues`                        |
| コメント                                   | `POST /api/comments`。JS が無ければ `POST /comments`                    |
| 質問に答える、選択肢、Use default、Dismiss | いつもフォームの POST。JSON API は画面が使っていない                    |
| Undo                                       | フォームの POST だけ。JSON API は無い                                   |
| dashboard の更新                           | SSE のあと `GET /api/questions`。変化があれば HTML を reload            |
| inbox の更新                               | 30 秒ごとに `GET /api/inbox`                                            |
| 一覧の更新                                 | 30 秒ごとに HTML を reload。API は呼ばない                              |
| ワークスペース切り替え、コマンドパレット   | `GET /api/inbox`                                                        |
| CLI が保存したあとの URL 表示              | `GET /p/<slug>/api/issues/<id>` (`src/index.ts:734`)                    |

## serve が HTTP 以外ですること

1 分ごとに、期限が近い質問と、止まった issue を見て、設定の通知コマンドを呼ぶ (`src/web.tsx:636-657`)。前の見回りが終わっていなければ次を始めない。これは route ではない。通知の URL は次の形なので、SPA の path はこれを保てる必要がある (`src/notify.ts:40-46`)。

- 質問: `<base>/p/<slug>/dashboard#q-<id>`
- issue: `<base>/p/<slug>/?id=<id>`

`base` はワークスペースの `publicUrl` が有ればそれ、無ければ `http://127.0.0.1:<port>` (`src/notify.ts:49-51`、`src/web.tsx:624`)。

質問を作る HTTP は無い。エージェントは CLI が `.yaru/questions/` に書き、開いている画面は SSE か poll で気づく。

## SPA と Connect への対応

計画で決まっていること (`docs/migration/PLAN.md:9-20`):

- API は Connect RPC。画面の型は proto から作る
- サーバーでの SSR をなくす。括弧内は、スクリプトが無くても Dashboard が見られること、と読んだ
- Markdown は画面が描く。API は生の Markdown を返す
- 待ち受けは 127.0.0.1 のまま。Origin と Host は P0-security

この読みで、フォーム POST と、フォームのための 303 は、スクリプトが無い画面のための入口なので RPC に畳む。フォームを残す読みは未決に置き、下書きは残さない方で書いた。

### 対応表

| 今の入口                                                                | 移行先                                          | 理由                                                                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /` の HTML                                                         | SPA の `/`。データは unary `ListProjects`       | SSR をやめる。同じデータの JSON は今無いので、HTML が読んでいるフィールドを RPC にする                                                                          |
| `GET /inbox` の HTML                                                    | SPA の `/inbox`。データは unary `GetInbox`      | データの JSON は既にある。query の失敗表示とトーストは、SPA が URL から読む                                                                                     |
| `GET /p/:slug/` の HTML                                                 | SPA の板。データは unary `GetPage`              | `GET /api/page` が同じ `PageData`。初期 HTML の埋め込みは要らなくなる                                                                                           |
| `GET /p/:slug/dashboard` の HTML                                        | SPA の dashboard。データは unary `GetDashboard` | 質問、issue、セッション、git を 1 画面がまとめて読んでいる。それを返す JSON は今無い                                                                            |
| `GET /api/page`                                                         | `GetPage`                                       | 板が既にこれを遷移のたびに呼んでいる                                                                                                                            |
| `GET /api/issues`                                                       | `ListIssues`                                    | 画面は未使用。CLI の個別 GET とは別。今ある入口なので残す                                                                                                       |
| `GET /api/issues/:id`                                                   | `GetIssue`                                      | CLI の `hintBoard` が使う                                                                                                                                       |
| `POST /api/issues` と `POST /issues`                                    | `SaveIssue`                                     | 部分更新の意味は JSON の方 (キーが有るフィールドだけ) に合わせる。フォームのカンマ区切りと 302 は、スクリプト無しの経路                                         |
| `GET /api/comments`                                                     | `ListComments`                                  | 今の JSON                                                                                                                                                       |
| `POST /api/comments` と `POST /comments`                                | `SaveComment`                                   | 画面の JS は JSON。フォームは同じ保存のスクリプト無し経路                                                                                                       |
| `GET /api/questions`                                                    | `ListQuestions`                                 | dashboard の live script が数えるのに使う。`GetDashboard` とは別に残す。今、変化の検知がこの一覧の id だけで済んでいる                                          |
| `GET /api/questions/:id`                                                | `GetQuestion`                                   | inbox を開き直したとき、答え済みの質問は `GetInbox` に入らない。トーストの復元がこれを使う                                                                      |
| `POST /api/questions/:id/answer` とフォームの answer                    | `AnswerQuestion`                                | 保存の入力は JSON の方 (`body`、`expectedStatus`、`force`)。`useDefault` の文の展開は、今はフォームだけがサーバーでやっている。下書きでは呼び出し側が本文を作る |
| フォームの undo                                                         | `UndoAnswer`                                    | JSON が無いので、フォームが渡している `answeredAt` を RPC の入力にする                                                                                          |
| `POST /api/questions/:id/cancel` とフォーム                             | `CancelQuestion`                                | 入力は id だけ。フォームの `expectedStatus` はサーバーが捨てている                                                                                              |
| `GET /events`                                                           | server stream `WatchWorkspace`                  | 中身は「変わった」という合図だけ。クライアントが取り直す今の形を保つ                                                                                            |
| `GET /api/inbox` の 30 秒 poll                                          | `GetInbox` をクライアントが 30 秒ごとに呼ぶ     | 全ワークスペースを監視しない、という今の理由を変えない                                                                                                          |
| 一覧の 30 秒 reload                                                     | `ListProjects` をクライアントが 30 秒ごとに呼ぶ | 今は HTML を取り直しているだけ                                                                                                                                  |
| manifest、icon、font、`app.js`、インライン CSS                          | 静的配信                                        | API ではない。CSS は Vite のファイルになる (今は HTML に埋め込んでいる)                                                                                         |
| `GET /p/:slug` の 302                                                   | SPA が `/p/:slug/` を板として開く               | サーバーの redirect に頼らない。未知 slug を先に 404 にするかは未決                                                                                             |
| 404 の HTML                                                             | SPA のエラー画面                                | データの 404 (無い issue の `GetPage` など) は RPC の応答に残す。HTTP ステータスの写し方は未決                                                                  |
| フォームの 303 と `error` `q` `answer` `comment` `answered` `workspace` | SPA の状態。path は残す                         | 通知とブックマークが `/dashboard#q-<id>` と `/?id=<id>` を使う。失敗の query は、スクリプト無しの戻りのためにサーバーが付けている                               |

`returnTo` と `next` は RPC に入れない。どの画面へ戻るかはクライアントの経路である。

ワークスペースをメッセージの `workspace` に置くのは下書きの置き場である。ヘッダにするかは未決。今の指定は path の `/p/<slug>` (`src/web.tsx:563`)。

### SPA が受け取る path

通知と今のリンクを壊さないために、次をクライアントの経路にする。

| path                 | 画面             | クライアントが URL から読むもの                        |
| -------------------- | ---------------- | ------------------------------------------------------ |
| `/`                  | プロジェクト一覧 | 無し                                                   |
| `/inbox`             | 受信箱           | `workspace` `q` `error` `answer` `answered`            |
| `/p/:slug/`          | 板               | 板の query 全部。加えて `error` `comment` `q` `answer` |
| `/p/:slug/dashboard` | dashboard        | `q` `error` `answer` `answered`                        |

fragment `#q-<id>` と `#q-<slug>-<id>` は、そのカードまでスクロールする今の印である (`src/inbox.ts:59-60`、dashboard のカード id)。

未知の path と、未知の slug を、同じ SPA のシェルで返すか、サーバーが 404 にするかは未決。今のサーバーは 404 の HTML を返す。

### 静的配信に残すもの

- `/manifest.webmanifest` の JSON は今のまま
- `/icon.svg` と 4 つの PNG のバイト列は今のまま (`src/pwa.test.ts:112-116` が、ロゴから作り直した結果と一致することを見ている)
- `/assets/inter-4.1.woff2` は同じファイル、同じ Cache-Control
- 板の JS と、今インラインの CSS と、dashboard と inbox と一覧のスクリプトは、Vite の成果物になる。URL は `/assets/app.js` の 1 本ではなくなる。画面が今読んでいる機能 (板のハイドレーション、SSE、poll、30 秒の reload) は SPA のコードが持つ
- `/p/<slug>/` の下にも届いている静的 URL は、画面が link していない。残すかは未決

## proto の下書き

場所は `docs/spec/proto-draft/yaru/v1/`。package は `yaru.v1`。`go_package` は付けない (フォルダは P0-layout)。import の起点は `docs/spec/proto-draft`。

| ファイル          | service            |
| ----------------- | ------------------ |
| `common.proto`    | メッセージだけ     |
| `issue.proto`     | `IssueService`     |
| `comment.proto`   | `CommentService`   |
| `question.proto`  | `QuestionService`  |
| `page.proto`      | `PageService`      |
| `dashboard.proto` | `DashboardService` |
| `project.proto`   | `ProjectService`   |
| `inbox.proto`     | `InboxService`     |
| `watch.proto`     | `WatchService`     |

フィールドの上のコメントが、元の入口である。

JSON の裸の配列 (`Issue` と `Comment` の一覧) は、proto では message の `repeated` にする。Connect の応答は message だからである。中身の並びは変えない。

## 未決

仕様として決めない。

1. フォーム POST と 303 を残すか。計画の「なくすもの」は SSR と、スクリプト無しで Dashboard が見られること、と読んだ。残すなら、対応表のフォーム行は RPC に畳めない。
2. `GET /api/page` と板 HTML が、無い issue でも本文に `PageData` を載せて 404 にする。Connect のエラーは成功の message を一緒に返さない。下書きの `GetPage` は今の JSON と同じ field を持つ message を返し、404 という status は書いていない。コードを NotFound にするか、message 内の `error` だけにするかは未決。
3. 質問の衝突の 409 と、本文に同梱する `question`。Connect では `AlreadyExists` も `Aborted` も HTTP 409 になりうる。`FailedPrecondition` は 400 になる。どのコードにするか、`question` を error details にするかは未決。今の JSON の形は `QuestionConflict` message として置いた。
4. status の決め方が、メッセージに `not found` という文字が含まれるか、である (`src/web.tsx:93`)。Go ではエラーの種類で分けるべきに見えるが、今の文を変えることになるので決めない。壊れた JSON の文も、Bun の `JSON.parse` の文なので写さない。
5. JSON の `null` と、キーが無いことは違う。`Issue.assignee` は null でもキーがある。`PageData.error` は無いときキーが無い。`SaveIssue` はキーが無いフィールドを変えない。proto3 に null は無い。下書きは `optional` の未設定を「無い」に使い、null と欠落を区別しない。配列は空と未設定が区別しにくいので、`labels_set` のような bool を付けた。`google.protobuf.FieldMask` にするかは決めていない。null と欠落の区別が要るなら P0-format と一緒に決める。
6. 時刻の文字列を `google.protobuf.Timestamp` にするか。今の JSON は ISO 8601 の文字列なので、下書きは `string` のままにした。
7. `int64` の proto JSON は文字列になる。トークン数などを `int64` にすると、今の JSON の数と型が変わる。下書きは数えるフィールドを `int64`、比率と USD を `double` にした。画面の型をどちらにするかは未決。
8. `patch` の JSON は `old_string` のような snake_case (`src/store.ts:71-77`)。他のフィールドは camelCase。CLI の `--patch` はこの JSON を読む。RPC の JSON 名を camelCase にするか、CLI と同じ snake_case を `json_name` で残すかは未決。下書きは `json_name` を付けない。
9. `useDefault` の接頭辞 `Go with the default action: ` を、サーバーが付けるか、クライアントが本文に含めるか。JSON API は付けない。下書きは `AnswerQuestion` の `body` に展開済みの文を入れる。
10. `next` のコメントはカード id だけと言い、正規表現は `[A-Za-z][A-Za-z0-9._-]*` である。RPC には `next` を入れていない。SPA が今の fragment をどこまで許すかは未決。
11. `POST /issues` の成功だけ 302 で、他のフォームは 303。失敗した issue フォームだけ 400 HTML で、コメントと質問は失敗も 303。スクリプト無しをやめるなら、この差は RPC に残らない。残すなら、どちらが意図か未決。
12. `/p/<slug>` はワークスペースが無くても 302。存在確認はスラッシュのあと。未知 slug の扱いは未決。
13. 未知の path に SPA のシェルを返すか、404 にするか。
14. ワークスペース slug を、RPC のフィールドにするか、ヘッダにするか。Origin と Host の決まり (P0-security) と一緒に見る。
15. `GET /events` を開いただけで `.yaru/questions/` と `.gitignore` を作る。`WatchWorkspace` が同じ副作用を持つかは未決。
16. SSE の 5 秒の `: ping` と、コメント行 `: connected`。Connect のストリームの keepalive に任せるかは未決。合図の payload は空の `WatchEvent` にした。今の `data` は文字 `change` だが、クライアントは到着だけを見ている。
17. inbox とプロジェクト一覧を server stream にするか。今は意図的に 30 秒の poll と HTML の reload である。下書きは unary のまま、間隔も 30 秒のままクライアントに置く。間隔を変えるかは未決。
18. `/p/<slug>/assets/app.js` のように、接頭辞の下にも届く静的 URL を残すか。画面の link はルートだけである。
19. `ListIssues` に `parent` や `limit` や cursor を足すか。`listIssues` と `pageIssues` はそれを持つが、HTTP は渡していない (`src/store.ts:104-110`、`src/store.ts:212`)。下書きには入れない。
20. 質問の作成、更新、acknowledge の RPC を足すか。今の HTTP には無い。CLI がファイルを書く。下書きには入れない。
21. dashboard と inbox の `?answered=` を、RPC の引数にするか。下書きでは `GetQuestion` で足りる、とした。開き直したときにトーストを復元する必要が無ければ、query ごと要らない。
22. `onError` の 409 HTML は到達しないように見える。死んだ分岐なら、移行先に写さない。断言はしない。
23. プロジェクト一覧がフォルダの絶対 path を HTML に出している (`src/projects/project-card.tsx:35-36`)。RPC に `root` を含めた。外に見せてよいかは P0-security。
24. セッションログのディレクトリ (`SessionHealth.directory`) も、ローカルの path である。同じ。
25. `IssueEvent` の `from` と `to` は、文字列か、文字列の配列か、null である (`src/issue-events.ts:24`)。下書きは oneof に分けた。元の JSON は 1 つの値なので、生成した型を画面の今の型に合わせる方法は未決。
26. `GET /events` は、接続の時点で `.yaru/comments` が有るときだけそこを監視する (`src/web.tsx:325-330`)。あとからディレクトリができたコメントは、その接続では届かない。issues ディレクトリが開けないときだけ `.yaru` 全体を再帰で見る (`src/web.tsx:316-320`)。この取りこぼしを Watch が真似るかは未決。今の事実としてはそう動く。
