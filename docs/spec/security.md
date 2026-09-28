# yaru の守りの約束

Go (API とデータと CLI と端末) と Vite + Preact の SPA (画面) に移したあとの `yaru serve` が守る約束。段階 0 の成果物で、実装はこの文書を正解にする。

この文書に無い振る舞いは足さない。曖昧な点は末尾の「未決」にあり、実装で決めない。根拠は各節のファイルと行。行は 2026-09-28 に読んだ版。

## 脅威

`yaru serve` は次の両方を持つ。

- 質問への回答と、 issue とコメントの書き換え。回答は質問ファイルに書かれ、期限後の回答は issue のコメントに写る。次にその issue を読んだエージェントが拾う (`src/questions.ts:20-21`, `src/questions.ts:230-239`)。 issue とコメントは git で管理され、エージェントの作業指示になる (AGENTS.md の「質問は git に入れない。issue とコメントは git で管理する」)。
- herdr の端末。シェルそのもの。

本文はエージェントが外から取ってきた文章を含み、画面は tailnet から開けて質問に答えられる。本文の HTML やスクリプトが動くと、人になりすましてエージェントへ指示を送れる (`src/markdown.ts:3-6`)。

したがって HTTP と Connect と WebSocket の全部の入口は、シェルを開く入口と同じ検査を通す。読み取り専用、静的ファイル、死活確認、プリフライトを例外にしない。検査の前に `.yaru/` を書き換えず、 herdr のプロセスを起動しない。許可リストを作るための `publicUrl` の読み取りだけは先に行ってよい。

今の TS 版は、待ち受けを `127.0.0.1` に限る以外、この検査を持たない。差は「今の TS 版との差」に書く。 Go 版は TS 版の穴を移植しない。

## 待ち受けと公開

- 待ち受けは IPv4 の `127.0.0.1` だけ。既定のポートは `47800` (`src/web.tsx:45`, `src/web.tsx:614-616`)。 `-p` / `--port` で変える (`src/index.ts:46`, `src/index.ts:356`)。検査に使うポートは、実際に bind したポート。
- `0.0.0.0` 、 `::` 、 LAN のアドレスでは待たない。 `:8787` のように全インターフェースで待つ resident-app (`~/workspace/resident-app/main.go:26-29`, `main.go:47`) には合わせない。
- 公開は、同じマシンの `tailscale serve` が `127.0.0.1:<port>` へプロキシする道だけ。常駐の説明は `~/dotfiles/home/modules/yaru.nix:10-11` 。 `tailscale funnel` では公開しない (同ファイル 11 行、 AGENTS.md の「 funnel で公開しない」)。
- yaru 自身は tailscale を起動しない。公開の操作はマシンの設定のまま。
- `::1` では待たない。今の TS 版も `hostname: "127.0.0.1"` だけなので、それに合わせる。

`tailscale serve <port>` は、 HTTPS を終端してからバックエンドへ HTTP でプロキシする。 TCP のバックエンドでは、バックエンドに届く `Host` は tailnet 側のリクエストの `Host` のままである (Tailscale v1.94.1 の `ipn/ipnlocal/serve.go:942-947` 。 Unix ソケットのときだけ `localhost` に差し替える)。 `yaru.nix` の公開はポート番号なので TCP であり、 `Host` はマシンの MagicDNS 名 (例: `mac.example.ts.net`) のようにポート無しで届く。あわせて次を付ける (`serve.go:1036-1043`)。

- `X-Forwarded-Host`: 入ってきた `Host`
- `X-Forwarded-Proto`: `https` (入ってきた接続が TLS のとき)
- `X-Forwarded-For`: tailnet 上の送信元アドレス

これら 3 つは、 `127.0.0.1` に直接繋いだクライアントも自分で付けられる。認可、リダイレクト先、生成する URL に使わない。

## Tailscale が付ける header

Serve はバックエンドへ出す前に、入ってきた次の header を消し、自分で付け直す (`serve.go:1046-1074`)。

| header                       | いつ付くか                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `Tailscale-User-Login`       | tailnet のユーザー (ログイン名。非 ASCII は RFC 2047 の Q エンコード)          |
| `Tailscale-User-Name`        | 表示名。同じく Q エンコードされ得る                                            |
| `Tailscale-User-Profile-Pic` | プロフィール画像の URL                                                         |
| `Tailscale-Headers-Info`     | `https://tailscale.com/s/serve-headers`                                        |
| `Tailscale-Funnel-Request`   | Funnel のとき `?1` 。このとき識別子の header は付かない (`serve.go:1058-1060`) |

タグの付いたノードには識別子を付けない (`serve.go:1066-1069`)。 WhoIs できないトラフィック (Funnel 、またはローカルマシン) にも付けない (`serve.go:1062-1064`)。公式の説明は <https://tailscale.com/docs/features/tailscale-serve> の Identity headers 。共有を受けた tailnet 外のユーザーにも識別子は付く。 Funnel のトラフィックには付かない。

`127.0.0.1` へ直接来たリクエストは、この削除を通らない。同じマシンのプロセスは `Tailscale-User-Login` を任意の値で付けられる。公式も、 localhost 以外で待つと header を偽装できると書いている。 localhost に限ると、偽装できるのはそのマシン上のプロセスだけになる。

約束:

- `Tailscale-User-Login` 、 `Tailscale-User-Name` 、 `Tailscale-User-Profile-Pic` 、 `Tailscale-Headers-Info` 、 `Tailscale-App-Capabilities` を認可に使わない。付いていても、無くても、値が違っても、同じ `Host` と `Origin` なら同じ結果にする。
- これらの値を画面、ログの本文、リダイレクト、生成する URL に出さない。
- `Tailscale-Funnel-Request` が 1 つでも付いていたら、値に関係なく `403` で拒否する。 Funnel のクライアントはこの header を外せない (プロキシが消してから `?1` を付ける)。ローカルの偽装者が自分で付ける分には、拒否されて損をするだけ。
- この拒否は、 Funnel を使わないという運用 (`yaru.nix:11`) のサーバ側の支えである。 `Host` と `Origin` の許可リストだけでは Funnel を止められない。 Funnel のブラウザは `Host` と `Origin` がどちらもそのマシンの `https://….ts.net` になる。
- 別のリバースプロキシを `127.0.0.1:<port>` の前に置かない。置くと、そのプロキシが header を素通ししたとき、 tailnet の外から識別子を偽装できる。

## 全部の入口での Host と Origin

検査は 1 つのミドルウェアで、ルータの前に掛ける。 Connect (単項もサーバストリームも)、 WebSocket のアップグレード、静的ファイル、 SPA の `index.html` 、フォント、 PWA 、今ある SSE に相当する読み取りを分けない。

拒否は `403` 、 `Content-Type: text/plain; charset=utf-8` 、本文は英語で、小文字で始まり、末尾にピリオドを付けず、期待と実際を含める。 header の値を HTML に埋め込まない。例:

```text
rejected host: expected 127.0.0.1:47800 or localhost:47800 or a configured public host, actual evil.example
```

### 許可リスト

毎リクエスト、登録済みワークスペースの `publicUrl` から作り直す。キャッシュして、消した `publicUrl` を残さない。列挙に失敗したワークスペースは足さない。全部失敗しても、ループバックの 2 つは残す。

ループバック (待ち受けポートを `P` とする):

- Host: `127.0.0.1:P` と `localhost:P`
- Origin: `http://127.0.0.1:P` と `http://localhost:P`

`publicUrl` はワークスペースごとの `.yaru/config.yml` の 1 行で、知らせのリンクの頭である (`src/notify.ts:27-35`, `src/notify.ts:49-51`)。例は `https://mac.example.ts.net` (`src/index.test.ts:590-595`)。次をすべて満たすものだけを許可リストに足す。

- URL として解析できる
- scheme が `https`
- host が空でなく、 userinfo が無い

ポートが省略または `443` のとき:

- Host: `hostname` (ポート無し)
- Origin: `https://hostname`

それ以外のポートのとき:

- Host: `hostname:port`
- Origin: `https://hostname:port`

hostname の比較は ASCII の大文字小文字を無視する (<https://www.rfc-editor.org/rfc/rfc3986#section-3.2.2>)。末尾のドットは削ってから比べる。 `http` の `publicUrl` 、パスだけが違う `publicUrl` 、壊れた値は許可リストに入れない。 `http` を将来許すかは未決。

ポート無しの `127.0.0.1` と `localhost` は許可しない。このサーバの HTTP ポートは `80` ではないので、ブラウザはポートを付ける。

### 全リクエスト

1. `Host` が許可リストに無い、空、 `@` を含む、許可リストに無いポート付き、なら拒否。
2. `Tailscale-Funnel-Request` があれば拒否。
3. `Origin` があれば、許可リストの Origin と完全一致しなければ拒否。 `Origin: null` は不一致。

`X-Forwarded-Host` では判断しない。

### GET と HEAD 以外

ブラウザは状態を変えるリクエストに `Origin` を付ける。 `Origin` と `Sec-Fetch-Site` はブラウザが上書きする禁止ヘッダであり、ページのスクリプトは任意の値を付けられない (<https://fetch.spec.whatwg.org/#forbidden-header-name>)。

- `Origin` が許可リストにあり、かつ `Sec-Fetch-Site` が無いか `same-origin` なら通す。
- `Origin` も `Sec-Fetch-Site` も無いなら通す。これは curl やテストのような、ブラウザ以外のローカルクライアント。今の CLI の書き込みは HTTP を通さない (ファイルへ直接書く)。 CLI が HTTP で行うのは、保存後に板の URL を出す GET だけである (`src/index.ts:730-737`)。
- それ以外は拒否する。 `Sec-Fetch-Site` が `cross-site` 、 `same-site` 、 `none` のときを含む。

クロスオリジンの `fetch` で `Content-Type: application/json` を付けるとプリフライトになる。プリフライトが無くても、単純なフォーム POST (`application/x-www-form-urlencoded` 、 `multipart/form-data` 、 `text/plain`) はブラウザが本リクエストを送る。 CORS はレスポンスを読めなくするだけで、サーバが処理することを止めない。だからサーバ側で `Origin` を見る。

GET / HEAD は、 `Origin` が無ければ通す (アドレスバー、知らせのリンク、上の CLI の GET)。 `Origin` があれば許可リストと一致させる。これにより、別オリジンの `EventSource` や `fetch` は届いても処理されない。 GET と HEAD のハンドラは `.yaru/` を書き換えず、 herdr を起動しない。今の HTTP の GET は `acknowledgedAt` を書かない。書くのは CLI の `yaru question get` と、待ちが終わったあとの `yaru question wait` である (`src/index.ts:579-584`, `src/index.ts:661`, `src/questions.ts:342-352`)。 Go 版でこの書き込みを RPC に移すなら、その RPC は GET 扱いにしない。

### WebSocket

ハンドシェイクのメソッドは GET である。 GET の規則だけでは、 `Origin` の無いアップグレードが通る。 `github.com/coder/websocket` v1.8.15 の `Accept` は、 `Origin` が空なら検証を通り、 `Origin` の host がリクエストの `Host` と一致すれば通す (`accept.go:36-37`, `accept.go:92-96`, `accept.go:229-241`)。 DNS リバインディングでは、攻撃者の名前が `Host` と `Origin` の両方になるので、この一致は通ってしまう。

約束:

- `Upgrade` が `websocket` のリクエスト (大文字小文字を無視) は、 `Origin` が許可リストにあるときだけアップグレードする。 `Origin` が無ければ拒否する。
- `Sec-Fetch-Site` があるときは `same-origin` だけ通す。
- この検査の前に `Accept` を呼ばない。 `InsecureSkipVerify` を true にしない。 `OriginPatterns` で許可リストの代わりにしない。
- resident-app は `websocket.Accept(w, r, nil)` だけである (`~/workspace/resident-app/terminal.go:29`)。 yaru はこれを十分とみなさない。
- クエリにトークンを載せない。 resident-app が載せるのは、ブラウザの WebSocket が `Authorization` を付けられないためである (`terminal.go:24-25`)。 yaru はトークン方式を採らない (下)。

### Connect

Connect の単項もストリームも、上の「 GET と HEAD 以外」を通った HTTP リクエストだけが手続きに入る。手続きごとの抜け道、開発用の無効化フラグ、 localhost だから省く、を作らない。

### CORS

`Access-Control-Allow-Origin` を返さない。リクエストの `Origin` を写さない。 `Access-Control-Allow-Credentials` を返さない。 SPA は同じオリジンから API を呼ぶ。クロスオリジンのクライアントは対象外。

### DNS リバインディング

攻撃者の名前が一度攻撃者のアドレスに解け、その後 `127.0.0.1` に解けると、ブラウザは `Host` にその攻撃者の名前を入れて `127.0.0.1` へ送る。ページと API が同じオリジンに見えるので、 CORS では止まらない。許可リストに無い `Host` を拒否することで止める。 `Origin` の検査は、許可された `Host` に対する別オリジンからのリクエスト (フォーム POST 、 `fetch` 、 WebSocket) を止める。両方が要る。

## CSRF 、 Cookie 、トークン

- Cookie は要らない。 `Set-Cookie` を返さない。セッション Cookie を導入しない。今の TS 版にも Cookie は無い (`src/` に `Set-Cookie` も Cookie の読み取りも無い)。
- 追加の Bearer トークンも要らない。境界は、 `127.0.0.1` の待ち受け、 tailnet の ACL と `tailscale serve` (Funnel は header で拒否)、 `Host` と `Origin` の検査である。
- resident-app のトークン (`~/workspace/resident-app/auth.go:16-17`, `auth.go:43-50`) は、全インターフェース待ち受けに対するものである (`README.md:49-54`)。 URL の `?token=` は履歴に残る (`web/src/client.ts:6-16`)。 yaru はこの形にしない。
- CSRF トークンも置かない。 Cookie が無く、状態を変えるリクエストは `Origin` と `Sec-Fetch-Site` で止める。
- 画面から見える秘密を localStorage に置かない。置くものが無い。

tailnet の ACL でこのノードの Serve に届くユーザーは、今の TS 版と同じく、画面の操作も (端末を入れたあとは) シェルも使える。特定のログイン名だけに限るかは未決。識別子 header をその判定に使い始めた瞬間、ローカルからの偽装と「タグ付きノードとローカルブラウザの見分け」が問題になる。今は使わない。

## 応答ヘッダー

すべての応答 (200 、 403 、 404 、 Connect 、静的ファイル、アップグレードを拒否した応答) に付ける。

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' http: https:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

理由:

- `script-src 'self'` と `script-src-attr 'none'` 。インラインのスクリプトと `on` 属性を許さない。 `'unsafe-inline'` と `'unsafe-eval'` を付けない。今の TS 版は文書にインラインスクリプトを埋め込んでいる (`src/ui/document.tsx:53-62`)。 SPA では外部ファイルにする。サイドバー幅の先読みも外部モジュールから行う。
- `style-src 'self'` 。 `<style>` の注入は許さない。 `style-src-attr 'unsafe-inline'` は、位置とパレット色の属性のためだけに許す。色は `LABEL_PALETTE` の 10 色だけであり、ラベル文字列そのものは入らない (`src/components/tint.ts:7-24`)。 issue 、コメント、質問、ラベルの文字列を `style` 属性、 `<style>` 、 `url()` に埋め込まない。
- `img-src` の `http:` と `https:` は、 Markdown が許す画像スキームと揃える (`src/markdown.ts:10`)。 `data:` は画像にもスクリプトにも許さない。
- `connect-src 'self'` は、同じオリジンの Connect と WebSocket (`ws` / `wss`) を含む。
- `frame-ancestors 'none'` と `X-Frame-Options: DENY` 。クリックで回答や issue の保存を押させる埋め込みを拒む。
- `base-uri 'none'` 。 `<base>` で相対 URL の向き先を変えない。
- `Referrer-Policy: no-referrer` 。 Markdown の外部リンクと外部画像へ、ページの URL (失敗した回答の下書きを query に載せる今の形を含む。 `src/web.tsx:149-157`) を送らない。
- CSP は重ねる防御である。 Markdown の検査を CSP で置き換えない。

## herdr を起動するとき

herdr のサーバがまだ無いとき、 herdr クライアントは自分の環境変数と作業ディレクトリでサーバを起こし、それが全部の pane に引き継がれる。これは `~/workspace/resident-app/herdr.go:215-218` のコメントが述べている。 herdr 本体のソースはこの作業では読んでいない。実装者は、このコメントを前提に、起動側で環境を絞る。

引き継がれると、 launchd の狭い `PATH` 、 `nix develop` の変数、 `APP_TOKEN` のような秘密が、あとから開いた pane 全部の環境になる。 yaru の常駐は `HOME` と、プロフィールの bin に `/usr/bin:/bin` を足した `PATH` だけを渡している (`yaru.nix:22-26`)。この環境のまま herdr のサーバを起こしてはいけない。

yaru が herdr を起動するすべての箇所 (PTY のクライアント、 `workspace list` のような CLI 呼び出し) で、子プロセスの環境は次だけにする。親の環境を `cmd.Env` に渡さない (`os.Environ()` を繋がない)。

親に存在するときだけ残す (`herdr.go:220-226`):

- `HOME`
- `USER`
- `LOGNAME`
- `SHELL`
- `TMPDIR`
- `SSH_AUTH_SOCK`
- `LANG`
- `LC_ALL`
- `LC_CTYPE`

`LANG` 、 `LC_ALL` 、 `LC_CTYPE` がどれも親に無いときだけ、 `LANG=en_US.UTF-8` を足す (`herdr.go:227-229`)。

`PATH` は親から引き継がない。次を組み立てる (`herdr.go:230-234`)。 `USER` が空のときは、 `/etc/profiles/per-user/...` から `/opt/homebrew/bin` までの 4 つを付けない。

```text
/etc/profiles/per-user/$USER/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

作業ディレクトリは `HOME` の値だけ (`herdr.go:53`, `terminal.go:38`)。ワークスペースのルート、リクエストが指定したパス、プロセスの現在ディレクトリを使わない。サーバを起こしたときの作業ディレクトリも pane に残るため。

PTY で herdr の画面を繋ぐときだけ、上の環境に `TERM=xterm-256color` と `COLORTERM=truecolor` を足す (`terminal.go:37`)。 CLI 呼び出しには足さない (`herdr.go:53`)。どちらが先にサーバを起こすかで、 pane 側の `TERM` が変わる。これは未決に書く。

さらに:

- 実行ファイルのパス、引数、環境、作業ディレクトリを、 HTTP と Connect と WebSocket のクライアントが指定できない。
- リクエストの header やフィールドを、子の環境へ写さない。 `APP_HERDR_SESSION` 、 `YARU_STATE_DIR` 、 `YARU_NOW` 、トークン、 `AWS_*` 、 `SSH_AUTH_SOCK` 以外のソケットを子へ足さない。 `SSH_AUTH_SOCK` は上の一覧にあるので、親にあれば残る。
- resident-app は `APP_HERDR_SESSION` を子の環境ではなく `--session` 引数にする (`herdr.go:207-212`)。 yaru が同じ引数を持つかは未決。持つとしても、値はサーバプロセスの環境からだけ読み、クライアントからは受け取らず、子の環境には入れない。
- 検査に落ちたリクエストではプロセスを起動しない。
- 既に動いている herdr サーバの環境は、あとから繋いだクライアントでは置き換わらない。絞った環境が効くのは、 yaru の起動がサーバを起こすとき。それでも毎回絞る。既に動いているサーバを、環境を揃える目的で止めて再起動しない。

resident-app が Web から送れるキーを `allowedKeys` に限っていること (`herdr.go:21-27`, `herdr.go:191-198`) は、 yaru の仕様にはしない。任意のコマンドを受けるかも未決。受ける場合も、入口の検査と環境の絞りは上と同じにする。

## 知らせコマンド

`config.yml` の `notify` は `sh -c` で動き、作業ディレクトリはワークスペースのルート、環境はプロセスの環境に `YARU_EVENT` 、 `YARU_URL` 、対象の id と題名を足したものである (`src/notify.ts:56-66`, `src/notify.ts:177-182`)。 HTTP から `config.yml` は書けない (書く経路は `src/` の HTTP ハンドラに無い)。

Go 版でも次を守る。

- `notify` のコマンド文字列を、 HTTP と Connect と WebSocket から設定できない。
- 子に渡す環境を、今より広くしない。 issue の本文や回答本文を環境変数に足さない (今も id と題名だけ)。
- サービスプロセスの環境に秘密を置かない。知らせは `process.env` を展開するため、置いた秘密がコマンドへ渡る。常駐の環境は `yaru.nix:22-26` の `HOME` と `PATH` の範囲に留める。

知らせの環境を許可リスト方式へ狭めるかは未決。狭めると、既存の `notify` コマンドが `HOME` と `PATH` 以外を見ている場合に壊れる。

## Markdown

API は issue 、コメント、質問の本文を、描画前の Markdown のまま返す (計画: Markdown は画面側で描き、今の `renderMarkdown` をそのまま使う)。サーバは HTML を返さない。別のサニタイザを通して「よく」しない。

画面で本文の HTML を作ってよいのは `renderMarkdown` だけである (`src/components/markdown.tsx:4-5`, `src/components/markdown.tsx:29`)。 `innerHTML` や `dangerouslySetInnerHTML` に、 API の文字列や `renderMarkdown` 以外の結果を入れない。

`src/markdown.ts` の規則を維持する。テストの期待値は `src/markdown.test.ts` 。

- 生の HTML はエスケープして文字として出す (`markdown.ts:34-36`, テスト "raw HTML is shown as text instead of running")。
- リンクのスキームは `http:` 、 `https:` 、 `mailto:` だけ。画像は `http:` と `https:` だけ (`markdown.ts:9-10`, `markdown.ts:145-149`)。
- スキーム判定の前に、タブ、改行、 `U+0000` から `U+0020` までと `U+007F` を除く (<https://url.spec.whatwg.org/#concept-basic-url-parser>)。除いた結果が危険なスキームならリンクにしない (テスト "a scheme split by control characters is still treated as unsafe")。
- 外部とみなすリンク (`http:` 、 `https:` 、または `//` で始まるもの) は `target="_blank"` と `rel="noopener noreferrer"` (`markdown.ts:54-56`)。
- `#` に続く数字の issue リンクは、同じオリジンに残る相対 URL だけ。 `https://…` 、 `//…` 、 `/\…` 、スキーム付きはリンクにしない (`markdown.ts:134-140`, テスト "a resolver that leaves the origin is not trusted")。 `issueHref` の戻りをこの関数に通す。
- コード、リンクの中、 URL の中の `#` に続く数字はリンクにしない (同ファイルのテスト)。
- チェックボックスは描画器が作る。本文の HTML からは作られない (`markdown.ts:65-68`)。

スキームの無い `//host` が外部リンクとして残るのは、今の `safeUrl` がスキーム無しをそのまま返すため (`markdown.ts:148`)。落とすかは未決。画面は今の関数の結果を維持する。

## リダイレクト

クライアントが渡した URL へ `302` や `303` で飛ばない。 `Location` を `X-Forwarded-Host` や `Host` から組み立てない。

フォームの戻り先を残すなら、今の範囲を超えない (`src/web.tsx:674-691`)。

- `/` で始まらない、 `//` で始まる、 `\` を含む、解析できない、合成オリジン `http://yaru.invalid` と違うオリジンになるものは、そのワークスペースの dashboard に戻す。
- パスは、そのワークスペースの `/` 、そのワークスペースの `/dashboard` 、 `/inbox` だけ。
- フラグメントに載せる「次のカード」は、 `^[A-Za-z][A-Za-z0-9._-]*$` に合うときだけ (`src/web.tsx:747-750`)。

戻り先の仕組みを Connect のレスポンスに置き換えること自体は、入口の一覧 (P0-routes) の仕事である。置き換えても、外部の URL へ誘導しない。

## 今の TS 版との差

Go 版で塞ぐ。 TS 版のテストが「拒否しない」ことを正しさの見本にしない。

| 項目                                                       | 今の TS 版                                                                                                                                                          | Go 版                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 待ち受け                                                   | `127.0.0.1` だけ (`src/web.tsx:616`)                                                                                                                                | 同じ。ポートは実際に bind した値                                                                                                  |
| Funnel                                                     | コードでは見ていない。運用で使わない (`yaru.nix:11`)                                                                                                                | `Tailscale-Funnel-Request` を拒否する                                                                                             |
| `Host`                                                     | 見ていない                                                                                                                                                          | 許可リスト以外を拒否する                                                                                                          |
| リクエストの `Origin`                                      | 見ていない                                                                                                                                                          | 上の規則。 `formReturnPath` の `http://yaru.invalid` は戻り先の検査であり、リクエストの `Origin` ではない (`src/web.tsx:676-689`) |
| Cookie / トークン / CSRF トークン                          | 無い                                                                                                                                                                | 引き続き置かない                                                                                                                  |
| CSP 、 `X-Frame-Options` 、 `Referrer-Policy` 、 `nosniff` | 応答に無い。インラインスクリプトがある (`src/ui/document.tsx:53-62`)                                                                                                | 上のヘッダーを全応答に付ける                                                                                                      |
| CORS                                                       | `Access-Control-Allow-Origin` を返していない                                                                                                                        | 返さないことを維持する                                                                                                            |
| 識別子 header                                              | 読んでいない                                                                                                                                                        | 読んでも認可に使わない                                                                                                            |
| 書き込みの入口                                             | フォーム POST と JSON POST が、検査なしで回答と issue とコメントを書く (`src/web.tsx:132-147`, `src/web.tsx:252-268`, `src/web.tsx:379-381`, `src/web.tsx:390-392`) | 同じ書き込みは、状態を変えるリクエストの検査を通ったあとだけ行う                                                                  |
| SSE `/events`                                              | 検査なし (`src/web.tsx:302-354`)                                                                                                                                    | 読み取りでも `Host` と、付いていれば `Origin` を検査する                                                                          |
| Markdown                                                   | `renderMarkdown`                                                                                                                                                    | 画面で同じ関数を使う。 API は生の Markdown                                                                                        |
| herdr                                                      | 無い                                                                                                                                                                | 起動するなら環境と作業ディレクトリを絞る                                                                                          |
| 知らせ                                                     | `sh -c` にプロセス環境を渡す (`src/notify.ts:182`)                                                                                                                  | 広げない。 HTTP からコマンドを変えられない                                                                                        |

切り替えのときに弱くなっていないかは、次のテストが Go 版で通っていることで見る。 TS 版と応答を比べる golden に、拒否しないことを期待値として書かない。

## テスト

テストは一時ディレクトリの `YARU_STATE_DIR` と、プロジェクトの外に作ったワークスペースだけで行う。本物の `.yaru` と `~/.local/state/yaru` は使わない。 herdr の実体は起動しない。子プロセスは、環境と作業ディレクトリを印字して終了する偽の実行ファイルにする。

待ち受け:

- リスナーのアドレスが `127.0.0.1` であり、 `0.0.0.0` でも `::` でもない。
- ポートを指定したとき、許可リストのループバックがそのポートになる。

`Host` と `Origin` 。書き込みを伴う手続きを 1 つ決め、拒否のあとにファイルのバイト列が変わっていないことと、偽 herdr が起動していないことを見る。

- `Host: evil.example` の GET 、 POST 、 Connect 、 WebSocket アップグレードが `403` 。
- `Host: 127.0.0.1:<port>` かつ `Origin: https://evil.example` の POST 、 Connect 、 WebSocket が `403` 。
- `Host: 127.0.0.1:<port>` かつ `Origin: http://127.0.0.1:<port>` の POST は通る。
- `Host: localhost:<port>` かつ `Origin: http://localhost:<port>` の POST は通る。
- `publicUrl: https://mac.example.ts.net` のとき、 `Host: mac.example.ts.net` かつ `Origin: https://mac.example.ts.net` は通る。同じ `Host` で `Origin: https://evil.example` は `403` 。 `Host: mac.example.ts.net:443` は `403` (ブラウザは 443 を付けない)。
- `publicUrl: http://mac.example.ts.net` は許可リストに入らない。その `Host` は `403` 。
- GET で `Origin` が無く、 `Host` がループバックなら通る (CLI の `hintBoard` と同じ形)。
- POST で `Origin` が無く `Sec-Fetch-Site: cross-site` なら `403` 。 POST で両方無ければ通る。
- GET で `Origin` が無く `Sec-Fetch-Site: cross-site` なら通る (知らせのリンク)。ファイルは変わらない。
- `Upgrade: websocket` で `Origin` が無ければ `403` 。偽 herdr は起動しない。
- 許可された `Origin` でも `Tailscale-Funnel-Request: ?1` なら `403` 。ファイルは変わらない。
- `Tailscale-User-Login` が `alice@example.com` のリクエストと、 header が無いリクエストは、同じ `Host` と `Origin` なら同じ成否になる。偽装したログイン名だけでは、拒否される `Origin` を通せない。

応答:

- 成功と `403` の両方に、上の CSP 、 `Referrer-Policy` 、 `X-Content-Type-Options` 、 `X-Frame-Options` がある。
- CSP に `'unsafe-inline'` がスクリプト側として含まれない (`style-src-attr` の `'unsafe-inline'` だけが許される)。 `'unsafe-eval'` が無い。
- `Set-Cookie` が無い。 `Access-Control-Allow-Origin` が無い。
- 文書応答にインラインの `<script>` が無い (外部の `src` だけ)。

herdr:

- 親に `APP_TOKEN=secret` 、 `YARU_STATE_DIR=/tmp/state` 、 `PATH=/evil` を置いた状態で子を起動し、子の環境にこれらが無い。
- 子の `PATH` が、上の組み立てそのものである。
- 子の作業ディレクトリが、ワークスペースではなく `HOME` である。
- PTY の起動だけが `TERM` と `COLORTERM` を持つ。 CLI の起動は持たない。
- リクエスト由来の文字列が、実行ファイルのパスと子の環境に現れない。

Markdown:

- `src/markdown.test.ts` のいまのテストを、画面側のテストとしてそのまま通す。期待する HTML を緩めない。
- 本文を受け取る RPC の応答に、描画済みの `<p>` や `<script` が含まれず、送った Markdown の文字列が含まれる。

リダイレクトを残す場合:

- `returnTo` が `https://evil.example` 、 `//evil.example` 、 `/\evil.example` 、別ワークスペースのパスのとき、外部へ飛ばない。今の `formReturnPath` と同じく dashboard に戻る。

## 未決

実装で埋めない。決まったらこの文書を更新する。

- 特定の `Tailscale-User-Login` だけを許すか。許すなら、ローカル直打ち (識別子が無い、または偽装できる) と Serve 経由を、 header 以外の何で見分けるか。今の TS 版は誰でも操作できる。許可リストの設定場所はソースに無い。共有を受けたユーザーを含むかは、公式ドキュメントが「共有相手にも識別子を付ける」と書いているので、許可制にするなら明示が要る。
- `publicUrl` の scheme が `http` のとき、許可リストへ入れるか。今の TS 版は scheme を検査しない (`src/notify.ts:34`)。この文書では入れない。
- ワークスペースごとに `publicUrl` の host が違うとき、 Serve の実体の `Host` がどれか。この文書は、登録された `https` の `publicUrl` の和を許す。実際の tailscale の `Host` と `publicUrl` が一致するかは、この作業ではライブのプロキシを叩いていない。
- `::1` で待つか。待たない前提だと、 `localhost` が `::1` に先に解ける環境では `http://localhost:P` が届かない。今の TS 版も届かない。
- WebSocket 以外の herdr CLI が先にサーバを起こしたとき、 pane に `TERM` が付かない (`terminal.go:37` と `herdr.go:53` の差)。サーバを起こす入口を 1 つに揃えるかは未決。
- yaru が `APP_HERDR_SESSION` を読むか。端末を切り替えの合格条件に入れない、という計画のため、製品としての端末の形は未決。
- 端末 API が任意のコマンドと任意のキーを受けるか。 resident-app の `allowedKeys` を採用するかも未決。
- 知らせコマンドへ渡す環境を、プロセス環境の展開から、 herdr と同じ許可リストへ狭めるか。
- Markdown の、スキームの無い `//host` を拒否するか (`src/markdown.ts:148`)。許可スキームのとき、検査で読み飛ばした制御文字を href から除かず `trimmed` を残すこと (`src/markdown.ts:149`) を変えるかも未決。画面は今の関数をそのまま使う。
- 失敗した回答の下書きを query に載せる今の形 (`src/web.tsx:149-157`) を SPA に残すか。残す場合でも `Referrer-Policy: no-referrer` は付ける。履歴への残りは、この形を残す限り続く。
- `Tailscale-App-Capabilities` (`--accept-app-caps`) を認可に使うか。今は使わない。
