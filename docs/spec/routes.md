# yaru serve の入口

段階 0 の P0-routes。Go 移行で API と画面の経路を作るときの正解にする。計画は `docs/migration/PLAN.md` (このファイルは司令塔だけが書き換える)。

推測で埋めていない。根拠は `ファイル:行`。コメントとコードが違うときはコードを書き、差は「コメントとコードの差」に置く。未決の節は、ユーザーの判断が要るものだけである。ここは今の TS 版の入口を写したもので、形式や出力をよくする変更は決めていない。

proto の下書きは `docs/spec/proto-draft/` にある。`proto/` ではない。

## 読み方

本番の `yaru serve` は `serve` が `createServerApp` を `127.0.0.1` で待ち受ける (`src/web.tsx:612-626`、`src/index.ts:350-356`)。

入口は 2 段ある。

| 段             | 関数                                  | 役割                                                            |
| -------------- | ------------------------------------- | --------------------------------------------------------------- |
| サーバー       | `createServerApp` (`src/web.tsx:480`) | 一覧、受信箱、静的ファイル、`/p/<slug>/` への振り分け           |
| ワークスペース | `createApp` (`src/web.tsx:70`)        | 1 つのワークスペースの板、dashboard、質問、issue、コメント、SSE |

`/p/<slug>/...` は接頭辞を外した URL で、そのワークスペースの `createApp` に渡す (`src/web.tsx:564-587`)。`createApp` 自身は接頭辞を知らない。リンクを作るときだけ `basePath` (例: `/p/app`) を使う (`src/web.tsx:479`)。

テストは `createApp` を接頭辞なし (`basePath` が `""`) でも呼ぶ。以下の「ワークスペース内の path」はその内側の path である。本番の path は、その前に `/p/<slug>` が付く。例外は、サーバー段にだけある path (`/`、`/inbox`、`/api/inbox`) と、両段に登録してある静的ファイルである。

`slug` は登録時にフォルダ名から `[A-Za-z0-9._-]` 以外を `-` に潰し、空なら `workspace`、重複には `-2` から添える (`src/workspaces.ts:74-76`、`src/workspaces.ts:28-31`)。照合は登録の `slug` と path パラメータの完全一致 (`src/workspaces.ts:49-50`)。

HEAD は、対応する GET を実行してから本文を捨てる (Hono `hono-base.js:279-281`)。GET として書いた入口は HEAD でも同じ status と header になる。`GET /events` の監視開始は `ReadableStream` の構築時なので (`src/web.tsx:308`)、HEAD でも questions ディレクトリを作るところまで入る。

GET でも POST でもない method は 405 にしない。登録が無ければ notFound の 404 になる。`POST /` と `OPTIONS /events` を一時ディレクトリで叩くと、どちらも 404 で `text/html; charset=UTF-8` だった。

## 共通

### 待ち受け

| 項目                 | 値                                                                                          | 根拠                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| hostname             | `127.0.0.1` だけ                                                                            | `src/web.tsx:620`                                         |
| port                 | 既定 `47800`。`--port` か `-p`                                                              | `src/web.tsx:46`、`src/index.ts:789-792`                  |
| アイドルタイムアウト | `0` (切らない)。リクエストごとにも `0`                                                      | `src/web.tsx:621-623`                                     |
| 既に port が使用中   | 終了コードを変えず、`yaru  already running  http://127.0.0.1:<port>` を stdout に出して戻る | `src/web.tsx:629-633`。テストは `src/web.test.ts:309-323` |
| 起動ログ             | `yaru  http://127.0.0.1:<port>`                                                             | `src/web.tsx:627`                                         |

Origin と Host の検査は、このサーバーには無い。計画の「守り」は P0-security の成果物であり、ここでは決めない。

起動時、カレントディレクトリがワークスペースなら `workspaces.json` へ登録する。ワークスペースでなければ無視する (`src/index.ts:352-355`、`src/workspaces.ts:24-38`)。これは HTTP の入口ではない。

### エラーの status

ワークスペースアプリの `onError` (`src/web.tsx:84-97`)。

| 条件                                  | `/api/` で始まる path       | それ以外                  |
| ------------------------------------- | --------------------------- | ------------------------- |
| `QuestionConflictError`               | 409、`{"error","question"}` | 409 の HTML (`ErrorView`) |
| `Error.message` に `not found` を含む | 404、`{"error"}`            | 404 の HTML               |
| それ以外                              | 400、`{"error"}`            | 400 の HTML               |

`error` は `Error.message`。Error でなければ `String(err)` (`src/web.tsx:777-779`)。

この分岐はエラーの種類ではなく、メッセージ文字列の部分一致である。`question not found: 1` も `issue not found: 9` も 404 になる (`src/web.test.ts:330-334`)。質問の衝突だけが型で 409 になる。

フォームの POST (回答・取り下げ・取り消し・コメント) は、この `onError` に乗せず、自分で捕まえて 303 の redirect にする。衝突でも 409 にはならない。`onError` の 409 HTML に入る経路は、ソース上は見つかっていない (フォームは全て catch する。`src/web.tsx:150-158`、`src/web.tsx:185-189`、`src/web.tsx:204-215`)。

壊れた JSON は Hono が `JSON.parse` し (`node_modules/hono/dist/request.js:114-115`)、その例外が `onError` に入る。`not found` を含まないので 400 と `{"error": <JSON.parse の message>}`。Bun で `{` を送ると message は `JSON Parse error: Expected '}'` だった。この文は Bun の `JSON.parse` の文なので、Go では写さない。移行後は InvalidArgument とし、期待した JSON と実際の失敗が分かる英語の文にする (後ろの決定)。

`c.json` の Content-Type は `application/json` (Hono `context.js:379`)。`c.html` は `text/html; charset=UTF-8` (`context.js:383`)。

ワークスペースアプリの notFound (`src/web.tsx:99-102`): path が `/api/` で始まれば 404 の `{"error":"not found"}`。そうでなければ 404 の HTML。HTML の戻りリンクは、そのワークスペースの板 (`basePath/`、`src/web.tsx:73-77`)。title は `pageTitle("Error")` なので `Error · yaru` (`src/ui/page-title.ts:4`、`src/web.tsx:76`)。

サーバーアプリの notFound (`src/web.tsx:494-501`) は、path に関係なく 404 の HTML。戻りリンクは `/` (`src/ui/error-view.tsx:7`)。したがって本番の `/api/nope` は JSON ではなく HTML の 404 である (一時ディレクトリで確認した)。`/p/<slug>/api/nope` はワークスペースアプリに渡るので JSON の 404 である。

`createServerApp` には `onError` が無い。そこでの予期しない例外は、Hono の既定で status 500、本文 `Internal Server Error` になる (`node_modules/hono/dist/hono-base.js:10-16`)。`createApp` は `onError` があるので、ワークスペースの中の例外はこの 500 にはならない。

未知のワークスペースは、`/p/<slug>/` 以降だけが 404 で、本文に `workspace not found: <slug>` を含む (`src/web.tsx:566-574`、`src/server.test.ts:108-110`)。`/p/<slug>` (末尾スラッシュなし) は存在を見ずに 302 で `/p/<slug>/` へ飛ばす (`src/web.tsx:562`)。query は付けない。`/p/missing` は 302、その先の `/p/missing/` が 404 になる (一時ディレクトリで確認した)。

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

回答・取り下げ・取り消しが受け付ける `returnTo` は、次の 3 つだけ (`src/web.tsx:678-695`)。

- `<basePath>/` (板)
- `<basePath>/dashboard`
- `/inbox`

`/` で始まらないもの、`//` で始まるもの、`\` を含むもの、別オリジン、上以外の path は `<basePath>/dashboard` に落とす。query は残し、`returnTo` に付いていた hash は捨てて、サーバーが新しい fragment を付ける (`src/web.tsx:695`、`src/web.tsx:699-705`)。

別ワークスペースの板への `returnTo` は無視される (`src/server.test.ts:84-91`)。

redirect は 303 See Other (`src/web.tsx:129-132` が理由を書いている。RFC 9110 section 15.4.4)。例外は `POST /issues` の成功だけで、status を渡さないので Hono の既定 302 になる (`src/web.tsx:300`、Hono `context.d.ts:430`、テスト `src/web.test.ts:225`)。

失敗したとき query に載せるもの:

| 名前        | 意味                                                  |
| ----------- | ----------------------------------------------------- |
| `error`     | `Error.message`                                       |
| `q`         | 質問 id                                               |
| `answer`    | 書きかけの回答。長いときは載せない                    |
| `comment`   | 書きかけのコメント。コメントのフォームだけ            |
| `workspace` | 戻り先が `/inbox` のときだけ、ワークスペースの slug   |
| `answered`  | 答えられた質問 id。dashboard と `/inbox` への成功だけ |

空文字は query に載せない (`src/web.tsx:701-703`)。

書きかけを載せるのは、`encodeURIComponent` した長さが 8000 以下のときだけ (`src/web.tsx:757-764`)。超えたら `error` だけを載せ、書きかけは捨てる。コメントは、ブラウザの戻るで欄に残っている、という前提 (`src/web.tsx:757-759`)。テストは `src/web.test.ts:366-377`。

`/inbox` の fragment は `q-<slug>-<id>` (`src/inbox.ts:59-60`)。それ以外は `q-<id>` (`src/web.tsx:728-730`)。

`next` は答えたあとに開く fragment で、受け付ける形は「コメントとコードの差」に書く。コードの正規表現を正とする。

答えた直後の取り消し (`answered`) を載せるのは、戻り先が dashboard か `/inbox` のときだけ (`src/web.tsx:743-747`)。板は載さない (`src/web.tsx:161`)。

### 書くファイル

`store.dir` は `<ワークスペース>/.yaru` (`src/store.ts:162-165`)。

| 操作                           | 書く場所                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| issue の保存                   | `.yaru/issues/<id>.md` (`src/store.ts:768-769`)。追跡する属性が変われば `.yaru/events/<id>.jsonl` に追記 (`src/issue-events.ts:50-62`、`src/issue-events.ts:82-83`) |
| blocks の相手側                | 相手の `.yaru/issues/<id>.md` と、その events (`src/store.ts:632-645`)                                                                                              |
| コメント                       | `.yaru/comments/<id>.md`。ディレクトリが無ければ作る (`src/store.ts:687`、`src/store.ts:722-723`)                                                                   |
| 質問の回答・取り消し・取り下げ | `.yaru/questions/<id>.md` (`src/questions.ts:614-615`)                                                                                                              |
| 期限切れのあとの回答           | 上に加え、issue へコメントを 1 件足す (`src/questions.ts:236-245`)                                                                                                  |
| `GET /events` の開始           | `.yaru/questions/` と、中の `.gitignore` (`*\n`) が無ければ作る (`src/web.tsx:322-325`、`src/questions.ts:606-611`)。質問が 1 件も無くても作る                      |

画面からの issue 保存は provenance を渡さない。session、worktree、branch は前の値のまま (`src/store.ts:47`、`src/store.ts:292-294`)。`answeredBy` とイベントの `by` は `git config user.name`。空なら `me` (`src/store.ts:464-467`)。

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

静的ファイルはワークスペースアプリにも登録してある (`src/web.tsx:249-251` と `src/web.tsx:554-556`)。本番では `/icon.svg` も `/p/<slug>/icon.svg` も届く。画面の link は常にルートの path である (`src/ui/document.tsx:37-46`)。

Service Worker の route は無い。置かない、と書いてある (`src/pwa.ts:8`)。`assets/fonts/LICENSE.txt` を配る route も無い。

## 各入口

### GET `/` プロジェクト一覧

`src/web.tsx:503-505`、中身は `src/web.tsx:593-609`。

- query も body も見ない。
- 200、`text/html; charset=UTF-8`。title は `yaru` (`src/server.test.ts:237`)。
- 登録のうち `.yaru/config.yml` がまだあるワークスペースを、登録順に出す (`src/workspaces.ts:43-46`)。各カードは slug、フォルダの絶対 path、答え待ちの質問 (status が `open` か `expired`)、`in_progress` の件数 (`src/web.tsx:595-604`、`src/projects/project-card.tsx:35-36`)。
- 副作用はファイルを書かない。各ワークスペースの質問と issue を読む。
- inline script は 30 秒後に `location.reload()` (`src/projects.tsx:43-45`)。`/assets/app.js` は読まない。
- 呼び出し元は、ブラウザが `/` を開いたとき。ホーム画面の manifest の `start_url` も `/` (`src/pwa.ts:30`)。
- ワークスペースが 0 件でも 200。本文は `No workspaces yet...` (`src/projects.tsx:30`)。

### GET `/inbox` 受信箱

`src/web.tsx:509-552`。定数 `INBOX_PATH` は `/inbox` (`src/inbox-page.tsx:20`)。

query:

| 名前        | 扱い                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------ |
| `workspace` | 失敗の戻り、または `answered` と組む slug                                                  |
| `q`         | 失敗した質問 id                                                                            |
| `error`     | 失敗の理由。該当カードがまだ答え待ちならその中、無ければ画面の上 (`src/inbox-page.tsx:64`) |
| `answer`    | 書きかけ                                                                                   |
| `answered`  | 取り消しの知らせを出す質問。`workspace` と両方あるときだけ読む (`src/web.tsx:512-517`)     |

body は無い。200 HTML。title は `Inbox · yaru` (`src/server.test.ts:176`)。

`readInbox` は全部のワークスペースの `open` と `expired` を混ぜ、blocking、dueSoon、noDeadline、proceeded に分ける (`src/inbox.ts:36-55`、`src/questions.ts:437-449`)。答え済みと取り下げは入れない (`questionRank` が 4 のときグループキーが無い。`src/questions.ts:452-458`)。

`answered` の質問が読めなければ知らせは出さない (`src/web.tsx:462-468`)。

副作用は書かない。inline script は 30 秒ごとに `GET /api/inbox` を見る (`src/web.tsx:541-547`、`src/ui/live-page.ts:188-201`)。間隔は 30000 (`src/web.tsx:49`)。全ワークスペースのファイル監視は重いので poll にしている (`src/web.tsx:48`)。

呼び出し元は一覧の Inbox リンク (`src/server.test.ts:238`) と、回答フォームの `returnTo=/inbox`。

### GET `/api/inbox`

`src/web.tsx:558-560`。query も body も見ない。200、`application/json`。

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

内側は `src/web.tsx:104-110`。`boardPageData` (`src/web.tsx:711-721`) が `getPageData` (`src/page.ts:94-152`) を呼ぶ。

query (板の URL と、`GET /api/page` が同じものを読む):

| 名前                                                 | 扱い                                                                                                                | 根拠                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `query`                                              | 部分一致。空は絞らない                                                                                              | `src/page.ts:95`、`src/store.ts:376-380`           |
| `id`                                                 | 開く issue。`new` は下書き。無い issue は current を null にして error                                              | `src/page.ts:164-183`                              |
| `status`                                             | issue の status。不正な値は例外                                                                                     | `src/store.ts:432-437`                             |
| `assignee`                                           | 文字列一致。`me` は git の名前、`none` と空は担当なし                                                               | `src/store.ts:203`、`src/store.ts:408-411`         |
| `label`                                              | そのラベルを含む                                                                                                    | `src/store.ts:375`                                 |
| `awaiting`                                           | `1` のときだけ、答え待ちの質問がある issue に絞る。他の値は絞らない                                                 | `src/page.ts:100`                                  |
| `sort`                                               | `priority` `updated` `created` `due`。空は `priority`。それ以外は 400                                               | `src/issue-order.ts:37-38`、`src/issue-order.ts:8` |
| `group`                                              | `status` `priority` `label` `none`。空は `status`                                                                   | `src/issue-order.ts:41-42`                         |
| `completed`                                          | `hide` `recent` `all`。空は `recent`。`status` が `done` か `canceled` のときは URL が何でも応答の display は `all` | `src/page.ts:104-110`                              |
| `view`                                               | `board` だけ board。それ以外は `list`                                                                               | `src/page.ts:51-52`                                |
| `new_status` `new_parent` `new_label` `new_assignee` | `id=new` の下書きの初期値。`new_assignee` の `me` と `none` は上と同じ読み替え                                      | `src/page.ts:165-175`、`src/page.ts:188-192`       |
| `error`                                              | これが有れば、issue が無いときの error より優先して `PageData.error` に入れる                                       | `src/web.tsx:719-720`                              |

`comment`、`q`、`answer` はサーバーの PageData には入らない。板のクライアントが URL から読む (`src/client/state.ts:233-244`)。

body は無い。

応答は HTML。status は、`id` が有って error が `issue not found: <id>` のときだけ 404。それ以外は 200 (`src/web.tsx:718-720`)。404 でも板の HTML は返す (`src/web.test.ts:380-390`)。title は、issue を開いていれば `#<id> <title> · <slug> · yaru`、そうでなければ `<slug> · yaru` (`src/web.tsx:78-81`、`src/server.test.ts:249`)。接頭辞が空のテストでは slug が title に入らない。

HTML には描画済みの板と、同じ props の JSON を `<script id="yaru-initial-state" type="application/json">` に埋める (`src/ui/board-page.tsx:7-17`)。`<` は `\u003c` に逃がす (`src/ui/board-page.tsx:23-24`)。クライアントはこれを読んで引き継ぐ (`src/client/main.tsx:5-31`)。

`PageData` のフィールドは `src/page.ts:64-92`。JSON にするとき `undefined` のキーは落ちる。`error` が無いときキーは無い。`questions` と `awaitingQuestionCount` は型の上では省略可能だが (`src/page.ts:73`、`src/page.ts:88`)、`getPageData` は常に配列と数を入れる。proto も常に入れる。

開いている issue の `commits` は、id が数字のときだけ git で探す。数字でなければ空 (`src/page.ts:136-139`)。`commitsForIssue` は数字以外を渡すと例外だが、ここは呼ばない。

副作用は `.yaru` を書かない。読むものは issue、コメント、質問、events、git の名前、数字 id のとき issue のコミット、stale の設定。

呼び出し元:

- ブラウザが板を開く。検索欄は JS が無いとき GET の form (`src/client/board/search-box.tsx:55-64`)
- 一覧の Issues リンク (`src/projects/project-card.tsx:52`)
- 通知の issue URL (`src/notify.ts:45-46`)
- 保存やコメントの redirect

不正な `sort` などの例外は、HTML なら 400 の ErrorView、`/api/page` なら 400 の JSON。`sort=nope` の `/api/page` は `invalid sort: expected priority, updated, created, or due, actual "nope"` だった。

### GET `/p/:slug/dashboard`

`src/web.tsx:114-127`、描画は `src/web.tsx:424-459`。

query は `q`、`error`、`answer`、`answered`。inbox と違い `workspace` は見ない (1 ワークスペースの画面だから)。`answered` の質問が無ければ知らせは出さない。

200 HTML。title は `Dashboard · <slug> · yaru` (`src/server.test.ts:248`)。

埋め込むデータ (`src/dashboard.tsx:35-52`):

- 質問を全部 (`listQuestions` のフィルタなし。status は読んだ時刻で `expired` を決める)
- issue を全部 (`listIssues` のフィルタなし。並びは `updatedAt` の新しい順。板の sort ではない。`src/store.ts:209`)
- `readSessionHealth` (Claude Code のログ。`~/.claude/projects/...`。`src/sessions.ts:87-88`)。窓は 7 日 (`src/sessions.ts:50`)
- `readRepositoryState`。git でなければ null (`src/repository.ts:26-27`)
- 上の query から作った `returned` と `answered`

副作用は書かない。セッションログと git を読む。

inline script は `EventSource(<basePath>/events)` と、変化のたびに `GET <basePath>/api/questions` (`src/web.tsx:449-454`、`src/ui/live-page.ts:174-186`)。入力中でなければ `location.reload()`。入力中 (回答欄に文字がある、欄に focus がある、取り消しの知らせが出ている) なら、すぐ読み直さず `#page-refresh` に「N new — Show」か「Updated — Show」を出す (`src/ui/live-page.ts:148-157`、`src/ui/live-page.ts:167-170`)。毎分の期限確認でも、期限を過ぎた答え待ちがあれば同じ関数で「Deadline passed — Show」を出す (`src/ui/live-page.ts:203-214`)。

呼び出し元はサイドバー、モバイルのリンク、一覧の Dashboard ボタン、通知の質問 URL (`src/notify.ts:40-41` は `/p/<slug>/dashboard#q-<id>`)。

この画面の JSON API は無い。質問一覧の API は dashboard の一部でしかない。

### POST `/questions/:id/answer` (フォーム)

`src/web.tsx:133-170`。常に 303。JSON は返さない。

body は `application/x-www-form-urlencoded` (画面の form は enctype を付けない)。`parseBody` の値が文字列でなければ空文字として扱う (`src/web.tsx:781-782`)。

| フィールド       | 意味                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body`           | 回答本文。選択肢ボタンは、その選択肢を `body` の値にする (`src/components/question-card.tsx:125-126`)                                                                                                                       |
| `useDefault`     | `"1"` のとき、保存する本文は `Go with the default action: ` に `defaultAction` (無ければ空) を足したもの。redirect に戻す書きかけは、この展開前の `body` (`src/web.tsx:141-144`、`src/dashboard.tsx:60`、`src/web.tsx:138`) |
| `expectedStatus` | 描いたときの status。空は渡さない。`answered` なら答えの置き換えとみなす (`src/questions.ts:203-209`)                                                                                                                       |
| `force`          | `"1"` のとき、答え済みを置き換える。画面のフォームは出していない。JSON API は `true` だけを見る                                                                                                                             |
| `returnTo`       | 上の許可リスト                                                                                                                                                                                                              |
| `next`           | 次の fragment                                                                                                                                                                                                               |

成功時の Location:

- dashboard か `/inbox` へ戻るとき、`answered=<id>` と、inbox なら `workspace=<slug>`。fragment は `next` か、答えたカード
- 板へ戻るとき query は足さない。fragment だけ

既定の戻り先 (returnTo が無い、または拒否) は dashboard。テストは `src/server.test.ts:71-81` (`/p/AsukaTravel/dashboard?answered=1#q-1`)。

失敗も 303。`error`、`q`、inbox なら `workspace`、書きかけ `answer`。not found でも 404 にはしない。

書くファイルは質問の md。期限が切れたあとの回答で issue が付いていれば、コメントも 1 件 (`src/questions.ts:236-245`)。

呼び出し元は `QuestionAnswerForm` と、カードの Answer、Use default、選択肢 (`src/components/question-answer-form.tsx:35-52`、`src/components/question-card.tsx:118-181`)。issue 画面、dashboard、inbox の 3 つが同じフォームを使う。JS が動いていても回答は fetch せず、この POST のままである (板の issue 保存やコメントとは違う)。

### POST `/questions/:id/undo` (フォーム)

`src/web.tsx:174-195`。JSON の対になる API は無い。

| フィールド   | 意味                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `answeredAt` | 取り消したい答えの時刻。空は渡さない。現在の `answeredAt` と違えば衝突 (`src/questions.ts:281-285`) |
| `returnTo`   | 上と同じ                                                                                            |

成功は 303。query は `q` と、inbox なら `workspace` と、人が打った回答だけを `answer` に戻す。Use default の接頭辞で始まる回答と、選択肢と完全一致する回答は欄に戻さない (`src/web.tsx:736-741`)。

失敗は 303 で `error` と `q`。書きかけは載せない。

断る条件は `src/questions.ts:274-303`。エージェントが acknowledge 済み、30 秒超過 (`src/questions.ts:252`)、期限後の回答でコメントに写したあと、status が answered でない、`answeredAt` の不一致。30 秒超過は `QuestionConflictError` ではないので、もし `onError` に乗れば 400 だが、フォームは 303 にする。

呼び出し元は dashboard と inbox の Undo (`src/components/answer-undo-toast.tsx:45-52`)。板はトーストを出さないので、この POST を描かない。

### POST `/questions/:id/cancel` (フォーム)

`src/web.tsx:197-219`。body は `returnTo`、`expectedStatus` (サーバーは読まない)、`next`。

成功は 303。query は足さず、fragment は `next` かそのカード。失敗は 303 で `error` と `q`。

答え済みは衝突 (`src/questions.ts:338-342`)。すでに canceled なら何も書かず成功と同じ redirect (`src/questions.ts:337`)。

画面は期限切れの Dismiss (`src/components/question-card.tsx:157-165`)。フォームは expired のときだけ描く (`src/components/question-answer-form.tsx:53-62`)。

### GET `/api/questions`

`src/web.tsx:221-228`。

query は `status` と `issue`。空は渡さない。`status` は `open` `expired` `answered` `canceled` (`src/questions.ts:499-503`)。不正なら 400。

200 は `{"questions":[...]}`。配列を裸で返さない (issue 一覧と違う)。並びは `compareQuestions` (`src/questions.ts:394`)。

呼び出し元は dashboard の live script (`src/ui/live-page.ts:178`)。フィルタなしで取り、`open` と `expired` をクライアントで数える。

### GET `/api/questions/:id`

`src/web.tsx:230-232`。200 は `Question` オブジェクトそのもの。包まない。無い id は 404 の `{"error":"question not found: <id>"}`。

画面は呼んでいない。`answered` のトーストは HTML を描くときにサーバーが読む。

### POST `/api/questions/:id/answer`

`src/web.tsx:234-243`。JSON body。

| フィールド       | 扱い                                                               |
| ---------------- | ------------------------------------------------------------------ |
| `body`           | そのまま `answerQuestion` へ。フォームと違い `useDefault` は見ない |
| `expectedStatus` | あれば文字列のまま。空文字も渡る (フォームは空を落とす)            |
| `force`          | `true` のときだけ true。`"1"` や `1` は false                      |

成功は 200 で `Question`。衝突は 409 で `{"error","question"}` (`src/web.test.ts:713-731`)。本文が空なら 400 (`src/questions.ts:220-223`)。無い id は 404。

画面は呼んでいない。フォームの POST が画面の経路。

### POST `/api/questions/:id/cancel`

`src/web.tsx:245-247`。body は見ない。200 で `Question`。答え済みは 409。無い id は 404 (`src/web.test.ts:761-772`)。すでに canceled なら 200 で、ファイルは書き換えない。

画面は呼んでいない。

### POST `/issues` (フォーム)

`src/web.tsx:253-301`。

絞り込みは query が空でない方を優先し、空なら body を使う (`src/web.tsx:255-264`)。

| body の名前                                                         | 意味                                                                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `query` `view` `label` `awaiting` `sort` `group` `completed`        | 戻る URL の絞り込み                                                                                             |
| `filter_status` `filter_assignee`                                   | 絞り込み。issue 自身の `status` と `assignee` とぶつからないように別名 (`src/client/issue/filter-inputs.tsx:6`) |
| `id`                                                                | あれば更新、無ければ作成                                                                                        |
| `title` `body`                                                      | キーが body に有るときだけ保存対象                                                                              |
| `status` `assignee` `labels` `dueDate` `priority` `parent` `blocks` | キーが有るときだけ。`labels` と `blocks` はカンマ区切りの 1 文字列 (`src/web.tsx:792-802`)                      |

画面が実際に name を付けているのは `id`、`title`、`body`、編集中だけの `dueDate`、絞り込みの隠し欄 (`src/client/issue-view.tsx:157`、`src/client/issue/description.tsx:69`、`src/client/issue/due-date-value.tsx:34`)。status や labels はボタンで、JS の `POST /api/issues` に載せる。JS が無い form POST では、開いていない属性はキーが無く、保存対象に入らない。

成功は 302 で `<basePath>/` に絞り込み query を付けた URL (`src/web.tsx:300`、`src/web.tsx:668-675`)。`id` は Location に付かない。

失敗は redirect しない。400 の HTML で、板を同じ絞り込みで描き、`current` を送られた下書きで置き、`error` を載せる (`src/web.tsx:280-298`)。title が空の作成は `title is required when creating an issue` (`src/web.test.ts:138-150`)。

呼び出し元は issue 画面の form (`src/client/issue-view.tsx:147-155`)。JS が動くときは `preventDefault` して `POST /api/issues` に回す (`src/client/issue-view.tsx:151-154`、`src/client/use-page-controller.ts:299-304`)。

### GET `/events`

`src/web.tsx:303-356`。query も body も見ない。

200。header は `content-type: text/event-stream; charset=utf-8`、`cache-control: no-cache`、`connection: keep-alive`。

最初に `: connected\n\n`。その後、ファイルの変化で `data: change\n\n`。5 秒ごとに `: ping\n\n` (`src/web.tsx:314-332`)。`data` は常に `change` だけで、どのファイルかは載らない。

監視するのは `.yaru/issues` (開けなければ `.yaru` を再帰)、`.yaru/questions`、存在すれば `.yaru/comments` (`src/web.tsx:316-331`)。`events/` は直接は見ない。issue 保存は issue ファイルも書くので、その変化で届く。comments ディレクトリが接続時に無いと、その接続ではコメントを見ない。

クライアントが切ると watcher と ping を止める (`src/web.tsx:333-347`)。移行後の stream の形は、後ろの決定 (ready、change、heartbeat) に従う。今の `: connected` と `: ping` と `data: change` は、その 3 つに対応する。

呼び出し元:

- 板。`onmessage` で 80ms 待ってから `GET /api/page` を今の URL の query で取り直す (`src/client/use-page-controller.ts:88-94`)
- dashboard の inline script (`src/ui/live-page.ts:175`)

inbox とプロジェクト一覧は、この SSE を使わない。

### GET `/api/issues`

`src/web.tsx:358-368`。200 は `Issue` の JSON 配列。`{"issues":...}` では包まない。

query は `status`、`assignee`、`label`、`query`、`due`。`due` は `overdue` のときだけ絞る。他の値は無視 (`src/web.tsx:365`)。`awaiting`、`sort`、`group`、`completed`、`view` は見ない。並びは `updatedAt` の新しい順で、板の sort ではない (`src/store.ts:209`)。

`parent` フィルタは `listIssues` にあるが、この入口は渡さない (`src/store.ts:63-69` と `src/web.tsx:360-366`)。

画面は呼んでいない。CLI の `hintBoard` は個別 GET の方を呼ぶ。

### GET `/api/page`

`src/web.tsx:371-374`。query は板の HTML と同じ。body は無い。

200 か 404 の `PageData` JSON。無い issue のときも `issues` などを含んだ 404 で、`error` は `issue not found: <id>`、`current` は null (`src/web.test.ts:340-348`)。クライアントは、404 でも `issues` が配列なら成功として読む (`src/client/use-page-controller.ts:311-316`)。

呼び出し元は板の遷移、戻る、SSE のあとの読み直し (`src/client/use-page-controller.ts:63`)。`cache: no-store`。

### GET `/api/issues/:id`

`src/web.tsx:376-378`。200 は `Issue`。無い id は 404 の `{"error"}` (`src/web.test.ts:330-334`)。

画面は呼んでいない。CLI が保存のあと、serve が居れば 200ms 以内にここを叩き、200 なら板の URL を stdout に出す (`src/index.ts:730-740`)。失敗は無視する。

### POST `/api/issues`

`src/web.tsx:380-383`。JSON を `SaveInput` として `saveIssue` に渡す (`src/store.ts:80-96`)。

キーが無いフィールドは変えない (`title !== undefined` など。`src/store.ts:267-290`)。proto では、未設定を「変えない」、空の `StringList` や空文字を「空にする」に分ける (後ろの決定)。

| フィールド                                                                         | 扱い                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                               | 無しなら作成。作成には空でない `title` が要る                                                                                                                                                             |
| `title` `status` `assignee` `labels` `dueDate` `priority` `parent` `blocks` `body` | 部分更新。`labels` と `blocks` は文字列の配列 (フォームのカンマ区切りとは違う)                                                                                                                            |
| `assignee` `dueDate` `priority` `parent`                                           | `""` と `none` は null。`assignee` の `me` は git の名前 (`src/store.ts:400-411`)                                                                                                                         |
| `addBlocks` `removeBlocks` `addBlockedBy` `removeBlockedBy`                        | `blocks` の代わりの差分。`blocks` と同時は 400 (`src/store.ts:542-545`)。画面は `blocks` の全置換を送る (`src/client/issue-view.tsx:96-98`)                                                               |
| `patch`                                                                            | 本文への操作の配列。`body` と同時は不可。新規には不可 (`src/store.ts:260-261`)。操作の形は `src/store.ts:72-78`。1 件から 50 件 (`src/store.ts:885-886`)。フィールド名は `old_string` のように snake_case |

成功は 200 の `Issue`。検証エラーは 400 の `{"error"}`。無い id の更新は 404。

画面が送るもの (`src/client/use-page-controller.ts:325-337` と、属性だけの部分更新 `src/client/use-page-controller.ts:178`):

- 新規と、開いている issue のまとめて保存は、id、title、status、assignee、labels、dueDate、priority、parent、blocks、body
- 属性 1 つは `{id, そのフィールド}`
- 列の移動は `{id, status}`
- 相手の blocked by は、相手 id に `{blocks: 配列}`

4xx は送り直さない。5xx と通信失敗は下書きを残して送り直す (`src/client/use-page-controller.ts:294-308`)。

### GET `/api/comments`

`src/web.tsx:385-389`。query の `issue` が空なら 400 で `issue is required when listing comments`。issue が無ければ 404 (`getIssue` が `issue not found`)。

200 は `Comment` の配列。古い順 (`src/store.ts:648-652`)。画面は呼んでいない。板は `GET /api/page` の `comments` を使う。

### POST `/api/comments`

`src/web.tsx:391-393`。JSON を `saveComment` に渡す (`src/store.ts:98-103`)。

| フィールド | 扱い                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------- |
| `id`       | 有ればそのコメントの本文を更新。画面は送らない                                            |
| `issue`    | 新規のとき。`parent` が有れば親の issue を使い、`issue` は見ない (`src/store.ts:678-679`) |
| `parent`   | 返信。画面のフォームは送らない。CLI は送れる (`src/index.ts:537`)                         |
| `body`     | 空や空白だけは 400                                                                        |

成功は 200 の `Comment`。`author` は git の名前。

画面は、JS があるときここを `{issue, body}` で呼ぶ (`src/client/issue/use-comment-posting.ts:38-42`)。

### POST `/comments` (フォーム)

`src/web.tsx:396-419`。常に 303。失敗しても HTML の 400 にはしない (issue フォームと違う)。

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
| `/assets/app.js`          | 200    | `text/javascript; charset=utf-8` | `no-cache`                            | 板のクライアントをその場で bundle (`src/web.tsx:471-475`、`src/client-script.ts:10-21`) |
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

`src/web.tsx:562`。302、Location は `/p/<slug>/`。query も hash も残さない。ワークスペースが無くても 302。テストは末尾スラッシュありの存在確認だけが 404 を見ている (`src/server.test.ts:101-106`)。

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

1 分ごとに、期限が近い質問と、止まった issue を見て、設定の通知コマンドを呼ぶ (`src/web.tsx:640-661`)。前の見回りが終わっていなければ次を始めない。これは route ではない。通知の URL は次の形なので、SPA の path はこれを保てる必要がある (`src/notify.ts:40-46`)。

- 質問: `<base>/p/<slug>/dashboard#q-<id>`
- issue: `<base>/p/<slug>/?id=<id>`

`base` はワークスペースの `publicUrl` が有ればそれ、無ければ `http://127.0.0.1:<port>` (`src/notify.ts:49-51`、`src/web.tsx:628`)。

質問を作る HTTP は無い。エージェントは CLI が `.yaru/questions/` に書き、開いている画面は SSE か poll で気づく。

## SPA と Connect への対応

計画で決まっていること (`docs/migration/PLAN.md:9-20`):

- API は Connect RPC。画面の型は proto から作る
- サーバーでの SSR をなくす
- Markdown は画面が描く。API は生の Markdown を返す
- 待ち受けは 127.0.0.1 のまま。Origin と Host は P0-security

スクリプト無しのフォームと 303 をやめるかは、未決 (ユーザー)。下書きの RPC は、やめるならフォームの代わり、残すならフォームと並ぶ。JS が今呼んでいる JSON は、どちらでも RPC にする。

Connect の手続きは全部 POST にする。`idempotency_level = NO_SIDE_EFFECTS` を付けない。付けると Connect がその単項を HTTP GET にでき、`docs/spec/security.md` の Origin の検査が書き込みより弱くなる。クライアントは `useHttpGet` と `WithHTTPGet` を有効にしない。

### 対応表

| 今の入口                                             | 移行先                                          | 理由                                                                            |
| ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /` の HTML                                      | SPA の `/`。データは unary `ListProjects`       | SSR をやめる。同じデータの JSON は今無い                                        |
| `GET /inbox` の HTML                                 | SPA の `/inbox`。データは unary `GetInbox`      | データの JSON は既にある。失敗の query とトーストを戻すかは未決 (ユーザー)      |
| `GET /p/:slug/` の HTML                              | SPA の板。データは unary `GetPage`              | `GET /api/page` が同じ `PageData`                                               |
| `GET /p/:slug/dashboard` の HTML                     | SPA の dashboard。データは unary `GetDashboard` | 質問、issue、セッション、git を 1 画面がまとめて読んでいる                      |
| `GET /api/page`                                      | `GetPage`                                       | 板が遷移のたびに呼んでいる。無い issue でも本文付きで返す                       |
| `GET /api/issues`                                    | `ListIssues`                                    | 今ある入口。返事は `{issues, now}` に包む                                       |
| `GET /api/issues/:id`                                | `GetIssue`                                      | CLI の `hintBoard`。無い id は NotFound                                         |
| `POST /api/issues` と `POST /issues`                 | `SaveIssue`                                     | 部分更新は JSON の方。フォームを残すかは未決 (ユーザー)                         |
| `GET /api/comments`                                  | `ListComments`                                  | 裸の配列を `{comments}` に包む                                                  |
| `POST /api/comments` と `POST /comments`             | `SaveComment`                                   | 画面の JS は JSON                                                               |
| `GET /api/questions`                                 | `ListQuestions`                                 | dashboard が答え待ちの顔ぶれを数える                                            |
| `GET /api/questions/:id`                             | `GetQuestion`                                   | 今の JSON。トーストの復元に使うかは未決 (ユーザー)                              |
| `POST /api/questions/:id/answer` とフォームの answer | `AnswerQuestion`                                | 入力は `body`、`expectedStatus`、`force`。`useDefault` は呼び出し側が本文にする |
| フォームの undo                                      | `UndoAnswer`                                    | JSON が無い。入力は `answeredAt`                                                |
| `POST /api/questions/:id/cancel` とフォーム          | `CancelQuestion`                                | 入力は id だけ                                                                  |
| `GET /events`                                        | server stream `WatchWorkspace`                  | `ready`、`change`、`heartbeat`。後ろの決定                                      |
| `GET /api/inbox`                                     | unary `GetInbox`                                | ライブ更新にするかは未決 (ユーザー)。今は 30 秒の poll                          |
| 一覧の 30 秒 reload                                  | unary `ListProjects`                            | ライブ更新にするかは未決 (ユーザー)                                             |
| manifest、icon、font、JS、CSS                        | 静的配信                                        | API ではない。CSS は今 HTML に埋め込まれている                                  |
| `GET /p/:slug` の 302                                | SPA が `/p/:slug/` を板として開く               | 未知の slug は 302 にせず 404                                                   |
| 404 の HTML                                          | 知っている画面 path 以外は 404                  | シェルを全 path に落とさない                                                    |
| フォームの 303 と query                              | SPA の状態。path は残す                         | 通知が `/dashboard#q-<id>` と `/?id=<id>` を使う。フォーム自体は未決 (ユーザー) |

`returnTo` と `next` は RPC に入れない。どの画面へ戻るかはクライアントの経路である。

ワークスペースの slug は、そのワークスペースの手続きの `workspace` フィールドに置く。ヘッダにはしない。`GetInbox` と `ListProjects` には無い。

### SPA が受け取る path

通知と今のリンクを残す。

| path                 | 画面             | クライアントが URL から読むもの                   |
| -------------------- | ---------------- | ------------------------------------------------- |
| `/`                  | プロジェクト一覧 | 無し                                              |
| `/inbox`             | 受信箱           | `workspace` `q` `error` `answer` `answered`       |
| `/p/:slug/`          | 板               | 板の query。加えて `error` `comment` `q` `answer` |
| `/p/:slug/dashboard` | dashboard        | `q` `error` `answer` `answered`                   |

`/p/:slug` に末尾のスラッシュが無いときは、slug が登録にあれば板を開く。登録に無ければ 404。今の 302 は、未知の slug でも飛ばしている (`src/web.tsx:562`)。

fragment `#q-<id>` と `#q-<slug>-<id>` はカードへの印。SPA が移動に使う fragment は、今のサーバーと同じ `/^[A-Za-z][A-Za-z0-9._-]*$/` だけ。

知っている画面 path 以外は 404。静的ファイルと Connect の path は除く。`/p/<slug>/assets/app.js` のように接頭辞の下へ静的ファイルを届けることはやめる。画面の link はルートだけである (`src/ui/document.tsx:37-46`)。

### 静的配信に残すもの

- `/manifest.webmanifest` の JSON は今のまま
- `/icon.svg` と 4 つの PNG のバイト列は今のまま (`src/pwa.test.ts:112-116`)
- `/assets/inter-4.1.woff2` は同じファイル、同じ Cache-Control
- 板の JS と、今インラインの CSS と、dashboard と inbox と一覧のスクリプトは、Vite の成果物になる

### サーバーの今

期限切れ、遅れ、stale を決める返事には `now` を入れる。ISO 8601 の文字列で、`currentTime()` の値 (`src/time.ts:7`)。`YARU_NOW` があればその時刻、無ければその手続きで読んだ 1 回の現在時刻。1 つの手続きの中で時計を 2 度読まない。

入れる返事は `GetPage`、`GetDashboard`、`GetInbox`、`ListProjects`、`ListIssues`、`GetIssue`、`SaveIssue`、`ListQuestions`、`GetQuestion`、`AnswerQuestion`、`UndoAnswer`、`CancelQuestion`。

画面は、期限切れと遅れと相対時刻にブラウザの `new Date()` を使わない。最後に受け取った `now` を使う。開いたまま時刻を進めて見せるときは、その `now` に経過を足さず、同じ手続きを取り直して新しい `now` に合わせる。`YARU_NOW` を固定したシナリオと、画面がずれないようにするため。

### ライブ更新

`WatchWorkspace` は server stream。1 件は次の oneof のどれか。

| 値          | いつ                                   | クライアント             |
| ----------- | -------------------------------------- | ------------------------ |
| `ready`     | つないだらすぐ。つなぎ直したときもすぐ | 取り直す                 |
| `change`    | issues、questions、comments が変わった | 取り直す                 |
| `heartbeat` | 約 5 秒ごと。今の `: ping`             | 取り直さない。接続の維持 |

切れたらつなぎ直す。`ready` を受けたら取り直すので、切れていた間の変化も拾う。今の板は、切れたあとにつながったときだけ読み直し、最初の接続では読み直さない (`src/client/use-page-controller.ts:99-106`)。移行後は最初の `ready` でも取り直す。板が今 80ms 待ってから `GetPage` する集まり方 (`src/client/use-page-controller.ts:94`) は、クライアントが持ってよい。

dashboard は、入力中ならすぐ取り直さず「N new — Show」を出す。毎分の期限確認も同じ知らせで「Deadline passed — Show」を出す。基準の時刻は返事の `now`。

`WatchWorkspace` は `.yaru/questions/` と `.gitignore` を作らない。今の `GET /events` は作る (`src/web.tsx:322-325`)。接続のあとでできた comments ディレクトリの変化も `change` にする。今は、接続時にディレクトリが無いとその接続では見ない (`src/web.tsx:326-331`)。

段階 1 で実機で確かめること。仕様としてはまだ合格にしていない。

- tailscale serve が server stream を溜め込まず、`ready` と `heartbeat` がすぐ届くか
- Go の HTTP サーバーの `WriteTimeout` を 0 にする。今の Bun は `idleTimeout: 0` と、リクエストごとの timeout 0 (`src/web.tsx:621-623`)

### エラーコード

今の `onError` は、メッセージに `not found` が含まれるかで 404 と 400 を分けている (`src/web.tsx:94`)。移行後はエラーの種類で分ける。文は今の英語を残す。壊れた JSON の文だけ、Bun の文を写さない。

| 状況                                                                                                             | Connect            | details            |
| ---------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------ |
| issue、質問、コメント、ワークスペースが無い                                                                      | NotFound           | 無し               |
| `expectedStatus` の不一致、`answeredAt` の不一致、答え済みの取り下げ、answered でない取り消し                    | Aborted            | `QuestionConflict` |
| 取り消しの 30 秒超過、acknowledge 済み、期限後の回答をコメントに写したあとの取り消し                             | FailedPrecondition | `QuestionConflict` |
| 空の回答、空の題名、不正な enum、壊れた JSON、`body` と `patch` の同時、`blocks` と差分の同時、日付や patch の形 | InvalidArgument    | 無し               |

`QuestionConflict` には、そのとき保存されている質問を入れる。Connect の status message が、今の JSON の `error` 文である。409 の HTML は、フォームが catch しており到達しない。移行後には作らない。

すでに canceled の取り下げは、今と同じく成功で、ファイルは書かない (`src/questions.ts:337`)。

`GetPage` で `id` の issue が無いときは NotFound にしない。`error` が `issue not found: <id>` で、`current` が未設定の `GetPageResponse` を成功で返す。板を描くため。`GetIssue` の無い id は NotFound で、issue は返さない。

### 画面の送り直し

今の板は、保存が 4xx なら送り直さず、5xx と通信失敗なら送り直す (`src/client/use-page-controller.ts:294-308`)。

Connect では、次だけ送り直す。

- Unavailable
- DeadlineExceeded
- Internal
- Unknown

InvalidArgument、NotFound、Aborted、FailedPrecondition は送り直さない。値を戻して理由を出す。

新規作成 (`SaveIssue` の `id` 無し、`SaveComment` の `id` 無し) は冪等ではない。応答が届く前に失敗した作成を送り直すと、issue やコメントが 2 つできる。自動では送り直さない。今も、新しい issue は人が Create を押し直すまで作らない (`src/client/use-page-controller.ts:254-255`)。人がもう一度押したときも、先の要求が実は成功していると二重になる。

### 列挙

`status`、`priority`、`sort`、`view` は enum にする。同じ閉じた組である質問の status、`group`、`completed`、patch の `kind` も enum にする。JSON の名前は `ISSUE_STATUS_TODO` のように、buf の STANDARD に合わせる。今の `"todo"` との対応は、次の揃え方の表。

入力でフィールドを省くか、`UNSPECIFIED` なら、今の空の指定と同じ (絞らない、または既定)。列挙に無い文字列と、未知の数値は InvalidArgument。`view` だけ今は未知の文字列を list に落とす (`src/page.ts:51-52`)。RPC ではそれも InvalidArgument にする。

出力に `UNSPECIFIED` は出さない。優先度が無い issue は `priority` を未設定にする。

### 値が無いことと空

保存で、フィールドが未設定なら変えない。

| 消したいもの              | 送り方                                                     |
| ------------------------- | ---------------------------------------------------------- |
| assignee、dueDate、parent | 空文字。`none` も今と同じく消える (`src/store.ts:400-411`) |
| priority                  | `IssuePriorityUpdate` をセットし、中を `UNSPECIFIED`       |
| labels                    | 空の `StringList`                                          |
| blocks                    | 空の `StringList` を `blocks` に置く                       |
| 本文を空にする            | `body` に空文字。oneof が未設定なら変えない                |

`blocks` の全置換と、add と remove は oneof で同時に書けない。`body` と `patch` も oneof。`labels_set` のような bool は付けない。`google.protobuf.FieldMask` は使わない。

読む返事では、JSON の null は optional の未設定にする。空の配列は空の `repeated` のまま (issue の labels は常に配列)。

### proto の置き場

`docs/spec/proto-draft/yaru/v1/`。package は `yaru.v1`。`go_package` は付けない。import の起点は `docs/spec/proto-draft`。`buf.yaml` の lint は STANDARD。

返事は手続きごとの `XxxResponse` で包む。同じ message を複数の手続きの返事に使わない。`Issue` や `Question` は、返事の中のフィールドとしては共有する。

手続きは `IssueService`、`CommentService`、`QuestionService`、`PageService`、`DashboardService`、`ProjectService`、`InboxService`、`WatchService`。

質問の作成、更新、acknowledge の RPC は無い。`ListIssues` に `parent`、`limit`、cursor は足さない。HTTP が渡していない (`src/store.ts:105-111`、`src/store.ts:213`)。

## 新旧の返事の揃え方

段階 2 で、同じ操作の古い HTTP と新しい Connect を比べるときは、次の規則で揃えてから差分を見る。`now` は古い返事に無い。比べる対象から外し、別に、その操作で使った時計 (`YARU_NOW` があればその文字列) と一致するかを見る。

### null とキーなし

読む返事では、古い JSON の `null` と、キーが無いことを、同じ「値が無い」にする。新しい proto JSON は、optional を未設定にするとキーが無い。

| 古い JSON          | 揃えたあと                   |
| ------------------ | ---------------------------- |
| `"assignee": null` | キーなし                     |
| キーが最初から無い | キーなし                     |
| `"priority": null` | キーなし                     |
| `"pushed": null`   | キーなし                     |
| `"labels": []`     | 空の配列。キーなしにはしない |
| `"error"` が無い   | キーなし                     |

保存の要求は、この表では揃えない。古い JSON でキーが無いことは「変えない」、`null` は「消す」で、意味が違う。新しい要求は、上の「値が無いことと空」に書く送り方にする。比べるのは保存のあとのファイルと、返った issue であり、要求の JSON そのものではない。

### 裸の配列と、包み

| 古い返事                             | 新しい返事から比べる中身                   |
| ------------------------------------ | ------------------------------------------ |
| `GET /api/issues` の配列             | `ListIssuesResponse.issues`                |
| `GET /api/comments` の配列           | `ListCommentsResponse.comments`            |
| `GET /api/questions` の `questions`  | `ListQuestionsResponse.questions`          |
| `GET /api/issues/:id` の Issue       | `GetIssueResponse.issue`                   |
| `GET /api/questions/:id` の Question | `GetQuestionResponse.question`             |
| `POST /api/issues` の Issue          | `SaveIssueResponse.issue`                  |
| `POST /api/comments` の Comment      | `SaveCommentResponse.comment`              |
| `POST` の Question                   | その手続きの `question`                    |
| `GET /api/page` の PageData          | `GetPageResponse` から `now` を除いたもの  |
| `GET /api/inbox`                     | `GetInboxResponse` から `now` を除いたもの |

並びは変えない。

### GetPage の本文付き 404

古い `GET /api/page?id=<無い id>` は status 404 で、本文は板の PageData (`src/web.tsx:718-720`、`src/web.test.ts:340-348`)。`error` は `issue not found: <id>`、`current` は null。

新しい `GetPage` は成功で、同じ板を返す。status の 404 は比べない。404 の本文を、成功の `GetPageResponse` から `now` を除いたものと比べる。`current: null` は、新しい optional の未設定と同じ。

`GetIssue` の無い id は、古い 404 の `{"error"}` と、新しい NotFound の message を比べる。本文の issue は両方に無い。

### 数値

int32 と double は、proto JSON でも数である。int64 は使わない。protobuf-es v2 が int64 を bigint にし、画面の number と混ざると落ちるため。件数と `ahead` と `behind` は int32 で、2^31-1 を超える数は表さない。セッションのトークン数 (`input_tokens`、`cache_creation_tokens`、`cache_read_tokens`、`output_tokens`) は double にする。1 セッションの cache read は 21 億を超えうるため。決定: 整数として正確なのは 2^53 まで。それを超える値は起こりえないとみなす。金額と比率も double である。

古い JSON の数と、新しい JSON の数を、そのまま比べる。文字列になっている数は不一致である。

### 列挙の名前

古い文字列と、新しい enum の JSON 名を、次の表で同じ値にする。この表は、そのフィールドが enum のときだけ使う。assignee の `none` や `me` は文字列のままである。

| 古い文字列      | enum の JSON 名               |
| --------------- | ----------------------------- |
| `backlog`       | `ISSUE_STATUS_BACKLOG`        |
| `todo`          | `ISSUE_STATUS_TODO`           |
| `in_progress`   | `ISSUE_STATUS_IN_PROGRESS`    |
| `done`          | `ISSUE_STATUS_DONE`           |
| `canceled`      | `ISSUE_STATUS_CANCELED`       |
| `urgent`        | `ISSUE_PRIORITY_URGENT`       |
| `high`          | `ISSUE_PRIORITY_HIGH`         |
| `medium`        | `ISSUE_PRIORITY_MEDIUM`       |
| `low`           | `ISSUE_PRIORITY_LOW`          |
| `open`          | `QUESTION_STATUS_OPEN`        |
| `expired`       | `QUESTION_STATUS_EXPIRED`     |
| `answered`      | `QUESTION_STATUS_ANSWERED`    |
| `priority`      | `ISSUE_SORT_PRIORITY`         |
| `updated`       | `ISSUE_SORT_UPDATED`          |
| `created`       | `ISSUE_SORT_CREATED`          |
| `due`           | `ISSUE_SORT_DUE`              |
| `status`        | `ISSUE_GROUP_STATUS`          |
| `label`         | `ISSUE_GROUP_LABEL`           |
| `none`          | `ISSUE_GROUP_NONE`            |
| `hide`          | `COMPLETED_VISIBILITY_HIDE`   |
| `recent`        | `COMPLETED_VISIBILITY_RECENT` |
| `all`           | `COMPLETED_VISIBILITY_ALL`    |
| `list`          | `ISSUE_VIEW_LIST`             |
| `board`         | `ISSUE_VIEW_BOARD`            |
| `replace`       | `PATCH_OP_KIND_REPLACE`       |
| `insert_before` | `PATCH_OP_KIND_INSERT_BEFORE` |
| `insert_after`  | `PATCH_OP_KIND_INSERT_AFTER`  |
| `prepend`       | `PATCH_OP_KIND_PREPEND`       |
| `append`        | `PATCH_OP_KIND_APPEND`        |
| `replace_range` | `PATCH_OP_KIND_REPLACE_RANGE` |

`group` の `priority` は `ISSUE_GROUP_PRIORITY`。質問の `canceled` は `QUESTION_STATUS_CANCELED`。issue の `canceled` は `ISSUE_STATUS_CANCELED`。どちらであるかはフィールドで分ける。

patch のフィールド名は、古い CLI の JSON が `old_string` でも、RPC の proto JSON は `oldString` である。`json_name` は付けない。CLI の `--patch` の入力は、この RPC ではなく、今の snake_case のまま残す。

`IssueEvent` の `from` と `to` は、文字列なら `fromText` か `toText`、配列なら `fromList.values` か `toList.values`、null ならその oneof が無い。揃えるときに、古い 1 つの値をこの形へ読み替える。

## コメントとコードの差

仕様はコードを正とする。コメントが狭いときも、コードの動きを写す。未決 (ユーザー) には置かない。

### next の fragment

コメントは、カードの id の形 (`q-<名前>-<番号>`) だけを通す、と書く (`src/web.tsx:749-751`)。コードは `/^[A-Za-z][A-Za-z0-9._-]*$/` に合うものを通す (`src/web.tsx:752-754`)。`proceeded` も通る (`src/dashboard.test.tsx:443`)。合わないものは答えたカードの fragment に戻す。SPA の fragment も、この正規表現に合うものだけをカードへの移動に使う。

## 未決 (ユーザー)

ここだけ、仕様として決めない。

1. スクリプト無しのフォーム POST と 303 をやめてよいか。計画の「なくすもの」は SSR と、スクリプトが無くても Dashboard が見られること、と読んだ。残すなら、フォームは RPC と並ぶ。issue の成功だけ 302 で、他のフォームは 303、という今の差は、残す場合も直さない。
2. 受信箱とプロジェクト一覧を、30 秒の定期取得のままにするか、ライブ更新にするか。今は全ワークスペースの監視を避けて poll と HTML の reload にしている (`src/web.tsx:48-49`、`src/projects.tsx:44-46`)。proto は unary のままにしてある。
3. 開き直したときに、答えた直後の取り消しの知らせ (`?answered=`) を戻すか。戻すなら `GetQuestion` でその質問を読む。戻さないなら、知らせは答えた直後の画面の状態だけでよい。
4. プロジェクト一覧のフォルダの絶対 path (`Project.root`) を、画面と API に出してよいか (`src/projects/project-card.tsx:35-36`)。
5. セッションログのディレクトリ (`SessionHealth.directory`) を、画面と API に出してよいか (`src/sessions.ts:45`)。
