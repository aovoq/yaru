# yaru の守りの約束

Go (API とデータと CLI と端末) と Vite + Preact の SPA (画面) に移したあとの `yaru serve` が守る約束。段階 0 の成果物で、実装はこの文書を正解にする。

この文書に無い振る舞いは足さない。曖昧な点は末尾の「未決」にあり、実装で決めない。根拠は各節のファイルと行。行は 2026-09-28 に読んだ版。

## 脅威

`yaru serve` は次の両方を持つ。

- 質問への回答と、 issue とコメントの書き換え。回答は質問ファイルに書かれ、期限後の回答は issue のコメントに写る。次にその issue を読んだエージェントが拾う (`src/questions.ts:20-21`, `src/questions.ts:230-239`)。 issue とコメントは git で管理され、エージェントの作業指示になる (AGENTS.md の「質問は git に入れない。 issue とコメントは git で管理する」)。
- herdr の端末。シェルそのもの。

本文はエージェントが外から取ってきた文章を含み、画面は tailnet から開けて質問に答えられる。本文の HTML やスクリプトが動くと、人になりすましてエージェントへ指示を送れる (`src/markdown.ts:3-6`)。

したがって HTTP と Connect と WebSocket の全部の入口は、シェルを開く入口と同じ検査を通す。読み取り専用、静的ファイル、死活確認、プリフライトを例外にしない。検査の前に `.yaru/` を書き換えず、 herdr のプロセスを起動しない。

今の TS 版は、待ち受けを `127.0.0.1` に限る以外、この検査を持たない。差は「今の TS 版との差」に書く。 Go 版は TS 版の穴を移植しない。

### ローカルの誰を信じるか

`Host` と `Origin` の検査が止められるのは、ブラウザのページである。 `Origin` と `Sec-Fetch-Site` はブラウザが上書きする禁止ヘッダで、ページのスクリプトは任意の値を付けられない (<https://fetch.spec.whatwg.org/#forbidden-header-name>)。

次は、この検査では守れない。

- ブラウザ拡張と、ページへ注入されたスクリプト。これらは開いている yaru と同じオリジンで動く。 `Origin` も CSP も、拡張や注入を止める対象にしない。
- 同じマシンの、ブラウザ以外のプロセス。 curl も、テストも、 sandbox に入ったエージェントも、 `Origin` を自分で付けられる。 `127.0.0.1` に繋がれば、許可された `Origin` を付けて WebSocket の端末 (シェル) と、 issue や回答の書き込みに届く。ネットワーク以外を拒否の決まりで縛ったエージェント (grok や Claude の sandbox) も、 localhost への接続が残っていれば、その縛りを HTTP 経由で外せる。
- 他の OS ユーザー。 TCP の `127.0.0.1` はマシンの全ユーザーから繋がる。モード `0600` のファイルや Unix ソケットは、所有者以外は開けない。

ブラウザ向けの `Origin` 検査だけで端末と書き込みが守れた、とは書かない。守る案の比較は「ローカルの非ブラウザ」にあり、どちらを採るかは未決。実装はその選択を埋めない。

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

拒否は `403` 、 `Content-Type: text/plain; charset=utf-8` 、本文は英語で、小文字で始まり、末尾にピリオドを付けず、期待と実際を含める。 header の値を HTML に埋め込まない。本文に写す `Host` と `Origin` は、制御文字 (`U+0000` から `U+001F` までと `U+007F`) を除いてから、 128 バイトを超える分を切る。改行を残さない。例:

```text
rejected host: expected 127.0.0.1:47800 or localhost:47800 or the configured public host, actual evil.example
```

### 許可する Host

ループバック (待ち受けポートを `P` とする) は常に許す。

- `127.0.0.1:P`
- `localhost:P`

ポート無しの `127.0.0.1` と `localhost` は許さない。このサーバの HTTP ポートは `80` ではないので、ブラウザはポートを付ける。

公開 host は、サーバープロセスの設定だけから 1 つ取る。ワークスペースのファイルからは取らない。 `.yaru/config.yml` はワークスペースの印で (`src/store.ts:125`, `src/store.ts:163`)、このリポジトリの `.gitignore` は `.yaru` を除外しない (`.gitignore` に `node_modules/` 、 `/dist` 、 `*.tgz` 、 `REPORT.md` しか無い)。 issue とコメントと同じく git で配られ得る。そこへ `publicUrl: https://evil.example` を書いた悪意のあるリポジトリを登録すると、その host が許可になる。 DNS リバインディングでその名前が `127.0.0.1` に解けると、 `Host` と `Origin` が両方とも攻撃者の名前になり、同じオリジンの GET が通る。

`publicUrl` は知らせのリンクの頭にだけ使う (`src/notify.ts:27-35`, `src/notify.ts:49-51`)。例は `https://mac.example.ts.net` (`src/index.test.ts:590-595`)。許可の判定には読まない。

公開 host の出どころは、上から最初に見つかった 1 つ。

1. `yaru serve --public-host HOST` 。今の TS 版の `yaru serve` にこのフラグは無い (`src/index.ts:46`)。 Go 版で足す。これは CLI の引数を TS 版と揃える、という移行の決まりの例外で、レビューが公開 host の出どころに指定したため。
2. 環境変数 `YARU_PUBLIC_HOST` 。未設定と空文字は区別する (`os.Getenv` では区別できないので、設定されているかを見る)。空文字のときは公開 host は無しで、次の自動検出はしない。値が hostname ならそれを使う。常駐では `yaru.nix` の `EnvironmentVariables` に書く (`yaru.nix:22-26` が環境変数の置き場)。
3. `tailscale status --json` の `Self.DNSName` 。フラグが無く、 `YARU_PUBLIC_HOST` も未設定のときだけ実行する。実行ファイルは、 `YARU_TAILSCALE_BIN` が設定されていればそのパス、未設定なら `PATH` 上の `tailscale` 。引数は `status` と `--json` だけ。読めない、終了コードが 0 でない、 `Self.DNSName` が空、なら公開 host は無しで、ループバックだけを許す。起動は失敗させない。テストは `YARU_TAILSCALE_BIN` を一時ディレクトリの偽の実行ファイルに向け、マシンに入っている `tailscale` を呼ばない。

`HOST` は hostname 、または hostname とポート `443` だけ。 URL 、 userinfo 、空、 `443` 以外のポートは起動時に拒否する (終了コードは 0 以外、標準エラーに期待と実際を書く)。 `443` は捨て、比較に使う公開 host はポート無しの hostname だけにする。ブラウザは `https` の `443` を `Host` に付けない。

比較の前に、 ASCII の大文字小文字を無視し、末尾のドットをすべて削る (<https://www.rfc-editor.org/rfc/rfc3986#section-3.2.2>)。 `Mac.Example.Ts.Net.` は `mac.example.ts.net` と同じである。

### Host に対応する Origin は 1 つ

`Origin` は、許可リストのどれかと合えば通る、ではない。そのリクエストの `Host` に対応する 1 つとだけ比べる。

| `Host` (正規化のあと)  | 対応する `Origin`      |
| ---------------------- | ---------------------- |
| `127.0.0.1:P`          | `http://127.0.0.1:P`   |
| `localhost:P`          | `http://localhost:P`   |
| 公開 host (ポート無し) | `https://` とその host |

`Host` が `127.0.0.1:P` で `Origin` が `https://公開host` の組は拒否する。逆も拒否する。 `Origin: null` は不一致。

### 全リクエスト

1. `Host` が空、 `@` を含む、上の 3 種のどれでもない、なら拒否。
2. `Tailscale-Funnel-Request` があれば拒否。
3. `Origin` があれば、その `Host` に対応する 1 つと完全一致しなければ拒否。

`X-Forwarded-Host` では判断しない。

### GET と HEAD 以外

ブラウザは状態を変えるリクエストに `Origin` を付ける。 `Origin` と `Sec-Fetch-Site` はブラウザが上書きする禁止ヘッダであり、ページのスクリプトは任意の値を付けられない (<https://fetch.spec.whatwg.org/#forbidden-header-name>)。

- `Origin` がその `Host` に対応する 1 つであり、かつ `Sec-Fetch-Site` が無いか `same-origin` なら、ブラウザ向けの検査は通す。
- `Origin` も `Sec-Fetch-Site` も無いなら、ブラウザ向けの検査は通す。今の CLI の書き込みは HTTP を通さない (ファイルへ直接書く)。 CLI が HTTP で行うのは、保存後に板の URL を出す GET だけである (`src/index.ts:730-737`)。この「両方無いなら通す」は、ブラウザ以外が `Origin` を偽装する穴を塞がない。端末と書き込みについては「ローカルの非ブラウザ」を見る。
- それ以外は拒否する。 `Sec-Fetch-Site` が `cross-site` 、 `same-site` 、 `none` のときを含む。

クロスオリジンの `fetch` で `Content-Type: application/json` を付けるとプリフライトになる。プリフライトが無くても、単純なフォーム POST (`application/x-www-form-urlencoded` 、 `multipart/form-data` 、 `text/plain`) はブラウザが本リクエストを送る。 CORS はレスポンスを読めなくするだけで、サーバが処理することを止めない。だからサーバ側で `Origin` を見る。

GET / HEAD は、 `Origin` が無ければ通す (アドレスバー、知らせのリンク、上の CLI の GET)。 `Origin` があれば、その `Host` に対応する 1 つと一致させる。これにより、別オリジンの `EventSource` や `fetch` は届いても処理されない。 GET と HEAD のハンドラは `.yaru/` を書き換えず、 herdr を起動しない。今の HTTP の GET は `acknowledgedAt` を書かない。書くのは CLI の `yaru question get` と、待ちが終わったあとの `yaru question wait` である (`src/index.ts:579-584`, `src/index.ts:661`, `src/questions.ts:342-352`)。 Go 版でこの書き込みを RPC に移すなら、その RPC は GET 扱いにしない。

### WebSocket

ハンドシェイクのメソッドは GET である。 GET の規則だけでは、 `Origin` の無いアップグレードが通る。 `github.com/coder/websocket` v1.8.15 の `Accept` は、 `Origin` が空なら検証を通り、 `Origin` の host がリクエストの `Host` と一致すれば通す (`accept.go:36-37`, `accept.go:92-96`, `accept.go:229-241`)。 DNS リバインディングでは、攻撃者の名前が `Host` と `Origin` の両方になるので、この一致は通ってしまう。

約束:

- `Upgrade` が `websocket` のリクエスト (大文字小文字を無視) は、 `Origin` がその `Host` に対応する 1 つであるときだけアップグレードする。 `Origin` が無ければ拒否する。
- `Sec-Fetch-Site` があるときは `same-origin` だけ通す。 `same-site` と `cross-site` は拒否する。
- この検査の前に `Accept` を呼ばない。 `InsecureSkipVerify` を true にしない。 `OriginPatterns` で許可リストの代わりにしない。
- resident-app は `websocket.Accept(w, r, nil)` だけである (`~/workspace/resident-app/terminal.go:29`)。 yaru はこれを十分とみなさない。
- クエリにトークンを載せない。 resident-app が載せるのは、ブラウザの WebSocket が `Authorization` を付けられないためである (`terminal.go:24-25`)。 yaru はトークン方式を採らない (下)。

### Connect

Connect の手続きは POST だけにする。単項もストリームも、上の「 GET と HEAD 以外」を通った POST だけが手続きに入る。手続きごとの抜け道、開発用の無効化フラグ、 localhost だから省く、を作らない。

Connect の GET は使わない。プロトコルは、 `idempotency_level = NO_SIDE_EFFECTS` を付けた単項を HTTP GET にできる (<https://connectrpc.com/docs/protocol> の Unary-Get-Request 、 <https://connectrpc.com/docs/go/get-requests-and-caching>)。 GET は上の規則で `Origin` が無くても通るので、読み取りの手続きを GET にすると、ブラウザ向けの検査が書き込みより弱くなる。 proto に `NO_SIDE_EFFECTS` を付けない。クライアントは `useHttpGet` と `WithHTTPGet` を有効にしない。 Connect のパスへの GET は、 `Host` が許されていても `405` にする。 `Host` が許されないときは `403` が先でよい。

`Content-Type` のメディアタイプ (パラメータを除く) は、次だけを受ける。

- `application/proto`
- `application/json`
- `application/connect+proto`
- `application/connect+json`

`application/connect+` で始まる他のメディアタイプ (例: `application/connect+xml`) は受けない。

それ以外は `415` 。 gRPC の `application/grpc` と gRPC-Web の `application/grpc-web` も `415` である。 connect-go の既定は 3 プロトコルを受けるので、そのままマウントしない (<https://connectrpc.com/docs/protocol> の Content-Type の説明)。 `application/json; charset=utf-8` はメディアタイプが `application/json` なので通す。

### CORS

`Access-Control-Allow-Origin` を返さない。リクエストの `Origin` を写さない。 `Access-Control-Allow-Credentials` を返さない。 SPA は同じオリジンから API を呼ぶ。クロスオリジンのクライアントは対象外。

### DNS リバインディング

攻撃者の名前が一度攻撃者のアドレスに解け、その後 `127.0.0.1` に解けると、ブラウザは `Host` にその攻撃者の名前を入れて `127.0.0.1` へ送る。ページと API が同じオリジンに見えるので、 CORS では止まらない。許可リストに無い `Host` を拒否することで止める。 `Origin` の検査は、許可された `Host` に対する別オリジンからのリクエスト (フォーム POST 、 `fetch` 、 WebSocket) を止める。両方が要る。

## CSRF 、 Cookie 、トークン

- Cookie は置かない。 `Set-Cookie` を返さない。セッション Cookie を導入しない。今の TS 版にも Cookie は無い (`src/` に `Set-Cookie` も Cookie の読み取りも無い)。 Cookie を足すと CSRF が戻る。
- ブラウザの跨ぎに対する CSRF トークンは置かない。 Cookie が無く、状態を変えるリクエストは `Origin` と `Sec-Fetch-Site` で止める。これはブラウザのページに対する検査である。
- 画面から見える秘密を localStorage に置かない。 resident-app は URL の `?token=` を localStorage に残す (`~/workspace/resident-app/web/src/client.ts:6-16`)。 yaru はこの形にしない。
- ローカルの非ブラウザに対して、起動ごとの秘密が要るかは未決 (「ローカルの非ブラウザ」)。「 Bearer は要らない」と決めない。 resident-app の常設トークン (`auth.go:16-17`, `auth.go:43-50`) は、全インターフェース待ち受けに対するもので (`README.md:49-54`)、 yaru の案とは別である。

tailnet の ACL でこのノードの Serve に届くユーザーは、今の TS 版と同じく、画面の操作も (端末を入れたあとは) シェルも使える。特定のログイン名だけに限るかは未決。識別子 header をその判定に使い始めた瞬間、ローカルからの偽装と「タグ付きノードとローカルブラウザの見分け」が問題になる。今は使わない。

## ローカルの非ブラウザ

ブラウザ向けの検査は、ページの跨ぎと DNS リバインディングを止める。同じマシンの curl や sandbox のエージェントは、対応する `Origin` を自分で付けて、その検査を通る。 TCP の `127.0.0.1` は他の OS ユーザーからも繋がる。端末と、 issue や回答の書き込みを、この先でどう守るかは次の 2 案で、採る方は未決。

### 案 A: モード 0600 の Unix ソケット

TCP では待たず、所有者だけが開ける Unix ソケットに待つ。 `tailscale serve` をそのソケットへ向ける。他の OS ユーザーはソケットを開けない。 sandbox が localhost の TCP だけを許していて、ソケットのパスを開く権限が無ければ、エージェントは届かない。同じユーザーでそのパスを開けるプロセスは届く。

Tailscale v1.94.1 は、 Unix ソケットへのプロキシではバックエンドの `Host` を `localhost` に書き換える (`ipn/ipnlocal/serve.go:942-945`)。ブラウザの `Origin` は `https://公開host` のまま残る。上の「 Host に対応する Origin は 1 つ」をこの `Host` のまま適用すると、スマホからの正当なリクエストが `403` になる。元の `Host` は `X-Forwarded-Host` に入る (`serve.go:1036-1037`) が、ソケットに繋げる同じユーザーはこの header を自分で付けられる。他の OS ユーザーは防げても、同じユーザーの偽装は header では防げない。

### 案 B: 起動ごとの秘密

起動のたびに秘密を作り、端末と書き込みはそれを知るクライアントだけ通す。 curl が `Origin` を偽装しても、秘密が無ければ端末と書き込みに届かない。

渡し方が漏れ方を決める。 URL のクエリは履歴に残る (resident-app がそうしている。 `web/src/client.ts:6-16`)。ブラウザの WebSocket は `Authorization` を付けられない (`terminal.go:24-25`)。ファイルに置くならモード `0600` にする。同じユーザーでそのファイルを読めるプロセスは秘密を持てる。 Cookie には入れない。スマホの `tailscale serve` へ秘密をどう渡すかも、この案を採るなら決めなければならない。

読み取りの GET まで秘密を要るかは、案の選択と一緒に未決。ブラウザ向けの検査のテストは先に書く。案が決まるまで、端末と書き込みを「 Origin 検査だけで完成」とみなさない。

## 応答ヘッダー

すべての応答 (200 、 403 、 404 、 405 、 415 、 Connect 、静的ファイル、アップグレードを拒否した応答) に付ける。端末を載せるページの `style-src` だけ、下の未決でこれと違い得る。

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' http: https:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

理由:

- `script-src 'self'` と `script-src-attr 'none'` 。インラインのスクリプトと `on` 属性を許さない。 `'unsafe-inline'` と `'unsafe-eval'` を付けない。今の TS 版は文書にインラインスクリプトを埋め込んでいる (`src/ui/document.tsx:53-62`)。 SPA では外部ファイルにする。サイドバー幅の先読みも外部モジュールから行う。
- `style-src-attr 'unsafe-inline'` は、位置とパレット色の属性のためだけに許す。色は `LABEL_PALETTE` の 10 色だけであり、ラベル文字列そのものは入らない (`src/components/tint.ts:7-24`)。 issue 、コメント、質問、ラベルの文字列を `style` 属性、 `<style>` 、 `url()` に埋め込まない。
- `<style>` 要素を許すかは、端末を載せるページだけ未決。 `@xterm/xterm` 6.0.0 は `createElement('style')` で `<style>` を差し込む (`~/workspace/resident-app/web/node_modules/@xterm/xterm/src/browser/Viewport.ts:79`)。 DOM 描画も同じことをする (`src/browser/renderer/dom/DomRenderer.ts:138`, 同ファイル 158)。 Viewport の `<style>` は描画器が WebGL でも残る。 `style-src 'self'` だけだと、この要素は CSP 違反になり端末が描けない。比較は下。端末を載せていないページは `style-src 'self'` のまま (インラインの `<style>` は許さない)。
- `img-src` の `http:` と `https:` は、 Markdown が許す画像スキームと揃える (`src/markdown.ts:10`)。 `data:` は画像にもスクリプトにも許さない。
- `connect-src 'self'` を付ける。 CSP の読みでは、同一オリジンの `ws:` と `wss:` を含む。 iOS Safari が `wss:` を実際に許すかは、この文書を書いた時点では実機で確かめていない。切り替えの前に実機で確かめる (テストの節)。
- `frame-ancestors 'none'` と `X-Frame-Options: DENY` 。クリックで回答や issue の保存を押させる埋め込みを拒む。
- `base-uri 'none'` 。 `<base>` で相対 URL の向き先を変えない。
- `Referrer-Policy: no-referrer` 。 Markdown の外部リンクと外部画像へ、ページの URL (失敗した回答の下書きを query に載せる今の形を含む。 `src/web.tsx:149-157`) を送らない。
- CSP は重ねる防御である。 Markdown の検査を CSP で置き換えない。

xterm の `<style>` をどう通すかは、次の 2 つで未決。合格条件は同じで、 xterm を組み込んだ build をブラウザで開き、 CSP 違反が 0 件であること。

- 端末のページだけ `style-src` に nonce を使う。サーバが出す `<style>` には nonce を付けられる。 xterm 6 は作った `<style>` に nonce を付けない (`Viewport.ts:79` は `createElement` だけ)。 CSP は nonce があると `'unsafe-inline'` を無視するので、無改造の xterm の `<style>` は nonce 方式では拒否される。通すなら、 xterm が作る要素へ nonce を付ける改造が要る。
- 端末のページだけ `style-src` に `'unsafe-inline'` を足す。無改造の xterm が動く。そのページでは、注入された `<style>` を CSP が止めない。本文の HTML は `renderMarkdown` がエスケープする。それでも端末ページの style の守りは、他のページより弱い。

スクリプト側の `'unsafe-inline'` と `'unsafe-eval'` は、どちらの案でも付けない。

## ログ

次をログに書かない。成功も失敗も、アクセスログの 1 行にも出さない。

- 回答、 issue 、コメント、質問の本文
- 端末の入出力
- リクエストの query (失敗した回答の下書きが query に載ることがある。 `src/web.tsx:149-157`)
- herdr の子に渡す環境、起動ごとの秘密、 `publicUrl` 以外の設定値のうち秘密になり得るもの

`403` のログに `Host` と `Origin` を出すときは、応答の本文と同じく、制御文字を除き、改行を残さず、 128 バイトで切る。ログ注入と、巨大な header の記録を避ける。

常駐は標準出力と標準エラーを `~/Library/Logs/yaru-serve.log` へ書く (`~/dotfiles/home/modules/yaru.nix:4`, `yaru.nix:32-33`)。 yaru はそのパスを決め打ちで触らない。テストがサーバを起動しても、本物のログのモードは変えない。

起動のあと、プロセスの標準出力と標準エラーが通常ファイルなら、その開いているファイルのモードを `0600` にする。パスの文字列ではなく、開いているファイル記述子に対して行う。パイプ、ソケット、端末のときは変えない。失敗してもサーバは落とさない (ログに出せないので、標準エラーが端末のときだけ理由を書く)。

launchd は yaru の処理が始まる前に、 `StandardOutPath` のファイルを作る。その時点ではモードが `0600` でない。今の `yaru.nix` はパスを渡すだけで、モードを指定しない (`yaru.nix:32-33`)。配り方の作業で、 launchd が開く前にそのファイルを `0600` で作る。この文書は `yaru.nix` を変えない。 yaru が開いているファイルを `0600` にするのは、起動したあとの窓を閉じるためで、起動前の窓は nix 側の案が閉じる。

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
- リクエストの header やフィールドを、子の環境へ写さない。
- 子に残す名前は、上の許可リストだけである。 `APP_HERDR_SESSION` 、 `YARU_STATE_DIR` 、 `YARU_NOW` 、トークン、 `AWS_*` 、 `HERDR_*` 、 `TMUX` で始まる名前は、親にあっても子へ残さない。ソケットのパスも、許可リストにある `SSH_AUTH_SOCK` 以外は残さない。
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

| 項目                                                       | 今の TS 版                                                                                                                                                          | Go 版                                                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 待ち受け                                                   | `127.0.0.1` だけ (`src/web.tsx:616`)                                                                                                                                | 同じ。ポートは実際に bind した値                                                                                                                                 |
| Funnel                                                     | コードでは見ていない。運用で使わない (`yaru.nix:11`)                                                                                                                | `Tailscale-Funnel-Request` を拒否する                                                                                                                            |
| `Host`                                                     | 見ていない                                                                                                                                                          | 許可リスト以外を拒否する                                                                                                                                         |
| リクエストの `Origin`                                      | 見ていない                                                                                                                                                          | その `Host` に対応する 1 つとだけ比べる。 `formReturnPath` の `http://yaru.invalid` は戻り先の検査であり、リクエストの `Origin` ではない (`src/web.tsx:676-689`) |
| 公開 host                                                  | 見ていない。 `publicUrl` は知らせのリンクだけ (`src/notify.ts:49-51`)                                                                                               | フラグ、 `YARU_PUBLIC_HOST` (空なら検出しない)、または `YARU_TAILSCALE_BIN` で差し替えた `tailscale status --json` の `Self.DNSName` 。 `config.yml` は使わない  |
| Cookie / CSRF トークン                                     | 無い                                                                                                                                                                | Cookie と CSRF トークンは置かない。起動ごとの秘密は未決                                                                                                          |
| CSP 、 `X-Frame-Options` 、 `Referrer-Policy` 、 `nosniff` | 応答に無い。インラインスクリプトがある (`src/ui/document.tsx:53-62`)                                                                                                | 上のヘッダーを全応答に付ける                                                                                                                                     |
| CORS                                                       | `Access-Control-Allow-Origin` を返していない                                                                                                                        | 返さないことを維持する                                                                                                                                           |
| 識別子 header                                              | 読んでいない                                                                                                                                                        | 読んでも認可に使わない                                                                                                                                           |
| 書き込みの入口                                             | フォーム POST と JSON POST が、検査なしで回答と issue とコメントを書く (`src/web.tsx:132-147`, `src/web.tsx:252-268`, `src/web.tsx:379-381`, `src/web.tsx:390-392`) | 同じ書き込みは、状態を変えるリクエストの検査を通ったあとだけ行う                                                                                                 |
| SSE `/events`                                              | 検査なし (`src/web.tsx:302-354`)                                                                                                                                    | 読み取りでも `Host` と、付いていれば `Origin` を検査する                                                                                                         |
| Markdown                                                   | `renderMarkdown`                                                                                                                                                    | 画面で同じ関数を使う。 API は生の Markdown                                                                                                                       |
| herdr                                                      | 無い                                                                                                                                                                | 起動するなら環境と作業ディレクトリを絞る                                                                                                                         |
| 知らせ                                                     | `sh -c` にプロセス環境を渡す (`src/notify.ts:182`)                                                                                                                  | 広げない。 HTTP からコマンドを変えられない                                                                                                                       |

切り替えのときに弱くなっていないかは、次のテストが Go 版で通っていることで見る。 TS 版と応答を比べる golden に、拒否しないことを期待値として書かない。

## テスト

テストは一時ディレクトリの `YARU_STATE_DIR` と、プロジェクトの外に作ったワークスペースだけで行う。本物の `.yaru` と `~/.local/state/yaru` は使わない。 herdr の実体は起動しない。子プロセスは、環境と作業ディレクトリを印字して終了する偽の実行ファイルにする。公開 host の検出を試すテスト以外は `YARU_PUBLIC_HOST` を空にし、マシンの `tailscale` を呼ばない。検出を試すテストは `YARU_TAILSCALE_BIN` を偽の実行ファイルにする。

待ち受け:

- リスナーのアドレスが `127.0.0.1` であり、 `0.0.0.0` でも `::` でもない。
- ポートを指定したとき、許可リストのループバックがそのポートになる。

`Host` と `Origin` 。書き込みを伴う手続きを 1 つ決め、拒否のあとにファイルのバイト列が変わっていないことと、偽 herdr が起動していないことを見る。

- `Host: evil.example` の GET 、 POST 、 Connect 、 WebSocket アップグレードが `403` 。
- `Host: 127.0.0.1:<port>` かつ `Origin: https://evil.example` の POST 、 Connect 、 WebSocket が `403` 。
- `Host: 127.0.0.1:<port>` かつ `Origin: http://127.0.0.1:<port>` の POST は通る。
- `Host: localhost:<port>` かつ `Origin: http://localhost:<port>` の POST は通る。
- `Host: LOCALHOST:<port>` と `Host: localhost.:<port>` は、 `Origin: http://localhost:<port>` のとき通る (大文字と末尾ドットを正規化する)。
- 公開 host を `mac.example.ts.net` にしたとき、 `Host: mac.example.ts.net` かつ `Origin: https://mac.example.ts.net` は通る。 `Host: Mac.Example.Ts.Net.` も同じ `Origin` で通る。同じ `Host` で `Origin: https://evil.example` は `403` 。 `Host: mac.example.ts.net:443` は `403` 。
- `Host: 127.0.0.1:<port>` かつ `Origin: https://mac.example.ts.net` は、公開 host が `mac.example.ts.net` でも `403` 。 `Host` に対応する 1 つ以外とは合わせない。
- ワークスペースの `config.yml` に `publicUrl: https://evil.example` を書いても、公開 host を別にしている (または公開 host が無い) とき、 `Host: evil.example` は `403` 。ファイルは変わらない。
- `YARU_PUBLIC_HOST` を空で渡し、 `YARU_TAILSCALE_BIN` を、起動されたら失敗する印の実行ファイルにする。その印は起動せず、ループバック以外の `Host` は `403` である。 `config.yml` の `publicUrl` だけでは公開 host にならない。マシンの `tailscale` は呼ばない。
- `YARU_PUBLIC_HOST` を未設定にし、 `YARU_TAILSCALE_BIN` を、 `{"Self":{"DNSName":"mac.example.ts.net."}}` を出して終了する偽の実行ファイルにする。公開 host は `mac.example.ts.net` になり、マシンの `tailscale` は呼ばない。
- GET で `Origin` が無く、 `Host` がループバックなら通る (CLI の `hintBoard` と同じ形)。
- POST で `Origin` が無く `Sec-Fetch-Site: cross-site` なら `403` 。 POST で両方無ければ通る。
- GET で `Origin` が無く `Sec-Fetch-Site: cross-site` なら通る (知らせのリンク)。ファイルは変わらない。
- `Upgrade: websocket` で `Origin` が無ければ `403` 。偽 herdr は起動しない。
- WebSocket で `Sec-Fetch-Site` が `same-site` のときと `cross-site` のときは、 `Origin` がその `Host` に対応していても `403` 。 `same-origin` だけ通る。
- 許可された `Origin` でも `Tailscale-Funnel-Request: ?1` なら `403` 。ファイルは変わらない。
- `Tailscale-User-Login` が `alice@example.com` のリクエストと、 header が無いリクエストは、同じ `Host` と `Origin` なら同じ成否になる。偽装したログイン名だけでは、拒否される `Origin` を通せない。

応答:

- 成功と `403` の両方に、上の CSP 、 `Referrer-Policy` 、 `X-Content-Type-Options` 、 `X-Frame-Options` がある。
- CSP に `'unsafe-inline'` がスクリプト側として含まれない (`style-src-attr` の `'unsafe-inline'` だけが許される)。 `'unsafe-eval'` が無い。
- `Set-Cookie` が無い。 `Access-Control-Allow-Origin` が無い。
- 文書応答にインラインの `<script>` が無い (外部の `src` だけ)。

herdr:

- 親に `APP_TOKEN=secret` 、 `YARU_STATE_DIR=/tmp/state` 、 `PATH=/evil` 、 `HERDR_SESSION=x` 、 `HERDR_BIN=/evil/herdr` 、 `TMUX=1` 、 `TMUX_PANE=%0` を置いた状態で子を起動し、子の環境にこれらが無い。 `HERDR_` で始まる名前と `TMUX` で始まる名前は、親にあっても子へ残さない。
- 子の `PATH` が、上の組み立てそのものである。
- 子の作業ディレクトリが、ワークスペースではなく `HOME` である。
- PTY の起動だけが `TERM` と `COLORTERM` を持つ。 CLI の起動は持たない。
- リクエスト由来の文字列が、実行ファイルのパスと子の環境に現れない。

Markdown:

- `src/markdown.test.ts` のいまのテストを、画面側のテストとしてそのまま通す。期待する HTML を緩めない。
- 本文を受け取る RPC の応答に、描画済みの `<p>` や `<script` が含まれず、送った Markdown の文字列が含まれる。

Connect:

- 許可された `Host` と、その `Host` に対応する `Origin` で、 Connect のパスへ GET すると `405` 。手続きは呼ばれず、ファイルは変わらない。
- 同じ経路への POST で、 `Content-Type` が `text/plain` 、 `application/grpc` 、 `application/connect+xml` のときは `415` 。 `application/json` 、 `application/proto` 、 `application/connect+json` 、 `application/connect+proto` は、この検査では拒否しない。

ログと 403 の本文:

- `Host` に改行と、 128 バイトを超える値を付けた `403` の本文とログに、改行が無く、写した host が 128 バイト以内である。
- 回答本文、 issue 本文、端末の入出力、 query 、子の環境を含む操作をしても、ログにそれらが出ない。
- 標準出力を一時ディレクトリの通常ファイルに向けて起動すると、そのファイルのモードが `0600` になる。 `~/Library/Logs/yaru-serve.log` はテストの対象にしない。標準出力がパイプのときは、モードを変えずに起動が続く。

ブラウザ:

- xterm を組み込んだ build を開き、端末を表示したときに CSP 違反が 0 件である。デスクトップ幅と、実機の iOS Safari の両方で見る。 iOS Safari では `connect-src 'self'` のまま `wss:` の端末接続が CSP で拒否されないことも見る。実機で見ていない間は、この項目を合格にしない。

リダイレクトを残す場合:

- `returnTo` が `https://evil.example` 、 `//evil.example` 、 `/\evil.example` 、別ワークスペースのパスのとき、外部へ飛ばない。今の `formReturnPath` と同じく dashboard に戻る。

## 未決

実装で埋めない。決まったらこの文書を更新する。

- 端末と書き込みを、案 A (モード `0600` の Unix ソケット) と案 B (起動ごとの秘密) のどちらで守るか。両方、または読み取りの GET まで秘密を要るかも未決。 Unix ソケットを採るなら、 Tailscale が書き換える `Host: localhost` と、ブラウザの `https://公開host` をどう照合するかも未決。秘密を採るなら、スマホの `tailscale serve` へ秘密をどう渡すかも未決。決まるまで実装はどちらも入れない。
- 端末ページの `style-src` を、 nonce (xterm が作る `<style>` へ nonce を付ける改造が要る) と、そのページだけの `'unsafe-inline'` のどちらにするか。
- 特定の `Tailscale-User-Login` だけを許すか。許すなら、ローカル直打ち (識別子が無い、または偽装できる) と Serve 経由を、 header 以外の何で見分けるか。今の TS 版は誰でも操作できる。許可リストの設定場所はソースに無い。共有を受けたユーザーを含むかは、公式ドキュメントが「共有相手にも識別子を付ける」と書いているので、許可制にするなら明示が要る。
- `::1` で待つか。待たない前提だと、 `localhost` が `::1` に先に解ける環境では `http://localhost:P` が届かない。今の TS 版も届かない。
- WebSocket 以外の herdr CLI が先にサーバを起こしたとき、 pane に `TERM` が付かない (`terminal.go:37` と `herdr.go:53` の差)。サーバを起こす入口を 1 つに揃えるかは未決。
- yaru が `APP_HERDR_SESSION` を読むか。端末を切り替えの合格条件に入れない、という計画のため、製品としての端末の形は未決。
- 端末 API が任意のコマンドと任意のキーを受けるか。 resident-app の `allowedKeys` を採用するかも未決。
- 知らせコマンドへ渡す環境を、プロセス環境の展開から、 herdr と同じ許可リストへ狭めるか。
- Markdown の、スキームの無い `//host` を拒否するか (`src/markdown.ts:148`)。許可スキームのとき、検査で読み飛ばした制御文字を href から除かず `trimmed` を残すこと (`src/markdown.ts:149`) を変えるかも未決。画面は今の関数をそのまま使う。
- 失敗した回答の下書きを query に載せる今の形 (`src/web.tsx:149-157`) を SPA に残すか。残す場合でも `Referrer-Policy: no-referrer` は付ける。履歴への残りは、この形を残す限り続く。
- `Tailscale-App-Capabilities` (`--accept-app-caps`) を認可に使うか。今は使わない。
