# 画面のシナリオ

段階 0 の画面の約束。Go へ移したあとも、ここにある状態を同じ手順で開いて、同じ点を確かめる。

この文書は今の TypeScript 版のソースから起こした。挙動の文には `ファイル:行` を添える。ソースに無いことは書かない。決められないことは末尾の「未決」に置く。

画面の文言 (ボタン、見出し、空の案内) はソースにある英語のまま書く。

## 読み方

- 配り方は `yaru serve`。登録されたワークスペースを `/p/<slug>/` の下に置く (`src/index.ts:350-356`, `src/web.tsx:477-478`)。
- `<slug>` は fixture の `manifest.json` の `main.slug`。既定の作り方では `ui-fixture`。
- 板のクエリは `src/client/view-model.ts:26-46` の `pageHref` が付けるものだけを既定と違うとき載せる。既定は view `list` (`src/page.ts:46`)、sort `priority`、group `status`、completed `recent` (`src/issue-order.ts:23-27`)。
- 確認する幅は 2 つ。デスクトップ 1280、スマホ 390。高さはソースが決めていない。撮影スクリプトは 1280×800 と 390×844 を使う。
- 幅の境は Tailwind の既定 (`node_modules/tailwindcss/index.css:331-333`)。`sm` は `40rem`、`md` は `48rem`、`lg` は `64rem`。`src/css.tsx:76` の `@theme` は breakpoint を上書きしない。文書のルートの字の大きさは指定がない (`src/ui/document.tsx:30`) ので、ブラウザの 16px なら 640px、768px、1024px。1280 は `lg` 以上。390 は `sm` 未満であり `md` 未満。
- `src/css.tsx:159` のサイドバーの開き直しは、明示の `@media (min-width: 768px)`。
- 下記の「1280」「390」は、その状態で幅によって変わる点だけを書く。書いていない部品は「幅の共通」に従う。

## 幅の共通

板 (`src/client/app.tsx:85-156`) と dashboard (`src/ui/page-shell.tsx` のコメント、`src/client/board/sidebar.tsx:50`) に共通する。

| 場所                                 | 1280                                                                                                        | 390                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| サイドバー `#sidebar`                | 見える (`md:flex`)。下端に `C` `new`、`/` `search`、`J` `K` `move` (`src/client/board/sidebar.tsx:128-129`) | 出ない (`hidden`)。畳むボタンも出ない                                                                           |
| ロゴ                                 | サイドバーの中                                                                                              | 見出しの帯の左 (`src/client/board/header.tsx:44` の `md:hidden`)                                                |
| 見出しの題と件数 (`All issues` など) | `sm` 以上で出る (`src/client/board/header.tsx:56`)                                                          | 出ない                                                                                                          |
| 検索                                 | 帯の中の欄。空のとき右に `/` (`src/client/board/search-box.tsx:60`, `104`)                                  | 虫眼鏡 `#search-open` だけ。押すと帯いっぱい (`data-expanded`)                                                  |
| Display                              | アイコンと `Display` (`lg:inline`, `src/client/board/display-menu.tsx:32`)                                  | アイコンだけ。面は左右 1rem を空けて帯の下 (`max-sm:fixed`, 同 20 行)                                           |
| New issue                            | 文字は `New issue` (`src/client/board/header.tsx:107`)                                                      | 文字は `New` (同 108 行)                                                                                        |
| ⌘K                                   | `#command-palette-open` に `⌘K` (`src/client/board/command-palette-button.tsx:25`)                          | アイコンだけ                                                                                                    |
| 絞り込みの札                         | 見出しの帯 (`hidden` … `md:flex`, `src/client/board/header.tsx:67`)。検索語の札は出さない                   | `#board` の上の帯 (`md:hidden`, `src/client/board/mobile-status-nav.tsx:19`)。検索語も札にする (`includeQuery`) |
| 状態の切り替え                       | サイドバーの Status                                                                                         | 横に流れる `All` と 5 状態 (`src/client/board/mobile-status-nav.tsx:27-38`)                                     |
| dashboard への数                     | サイドバーの Dashboard の件数                                                                               | 帯の `#mobile-dashboard-link`。数だけ見える (`src/client/board/header.tsx:72-82`)                               |
| 一覧の行                             | 1 行。`lg` で全部のラベル、`sm` で期日の列 (`src/client/board/issue-row.tsx:71-78`)                         | 題名の下に期日と、code point で最初のラベル 1 つ (`data-row-meta`, 同 63 行)。担当の丸は残る                    |
| 板の列 (`view=board`)                | 列幅 272px、snap なし (`src/client/board/board-column.tsx:64`, `src/client/board/board-view.tsx:35`)        | 列幅 `85vw`、横スクロールで 1 列ずつ止まる (`snap-x`)                                                           |
| issue 画面                           | `lg` で左が本文、右 18rem が属性 (`src/client/issue-view.tsx:170`)                                          | 1 列。順は答え待ち、題名、よく変える属性、説明、残りの属性、子 issue 以降 (同 32 行のコメント)                  |
| 属性の見出し `Properties`            | 出る (`hidden lg:block`, 同 201 行)                                                                         | 出ない。上下の線で区切る                                                                                        |
| issue のパンくずの題名               | `sm` 以上で出る (`src/client/issue/issue-view-header.tsx:52`)                                               | 番号だけ                                                                                                        |
| `⌘⏎` の表記                          | Create、Comment、Answer に出る                                                                              | 出ない (`hidden` … `sm:inline-flex`)                                                                            |
| 入力欄の字                           | `sm` 以上は本文の 13px                                                                                      | 16px。iOS が拡大しないため (`src/css.tsx:59`, `src/client/board/search-box.tsx:102`)                            |
| 画面の高さ                           | `h-dvh` (`src/client/app.tsx:87-90`)                                                                        | 同じ。`100vh` は使わない                                                                                        |

サイドバーを畳むと `html[data-sidebar="closed"]` になり、768px 以上で `#sidebar-open` が出る (`src/css.tsx:156-162`)。390 では元からサイドバーが無いので、このボタンは出ない。開閉は `localStorage` の `yaru.sidebar.open` (`src/client/use-sidebar-preference.ts:23`)。幅は `yaru.sidebar.width`。初期値は描く前の inline script (`src/ui/document.tsx:13`)。

## fixture との対応

`testdata/ui/fixture/make-fixture.sh` がワークスペースを 3 つ作る。題名と id は `$ROOT/manifest.json`。CLI は `YARU_BIN` の実行ファイルで、無ければ worktree の `cmd/yaru` を `$ROOT/bin/yaru` にビルドして使う。

| キー                        | 役割                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `main.issues.ship`          | 期限切れの期日、ラベル `bug`、担当 Fixture、本文に Markdown とタスクと `#` のリンク、他の issue を block する |
| `main.issues.spec`          | 進行中、ラベル `docs`、担当 Ada、明日の期日、状態を変えた活動がある                                           |
| `main.issues.stale`         | 進行中のまま更新が古く、Stale                                                                                 |
| `main.issues.oldDone`       | 完了から 7 日より前。既定の一覧では隠れる                                                                     |
| `main.issues.recentDone`    | 完了から 7 日以内。既定で見える                                                                               |
| `main.issues.canceled`      | 取りやめから 7 日以内                                                                                         |
| `main.issues.backlog`       | backlog、ラベル `chore`                                                                                       |
| `main.issues.child`         | `ship` の子                                                                                                   |
| `main.issues.blocked`       | `ship` に止められている                                                                                       |
| `main.questions.blocking`   | 既定も期限も無い open。`spec` に付く                                                                          |
| `main.questions.dueSoon`    | 既定が選択肢の 1 つ。期限は未来。`ship` に付く                                                                |
| `main.questions.noDeadline` | 既定はあるが期限は無い。`backlog` に付く                                                                      |
| `main.questions.expired`    | 期限が過去。`stale` に付く                                                                                    |
| `main.questions.answered`   | 答え済み。`ship` に付く                                                                                       |
| `main.questions.canceled`   | 取り下げ。`recentDone` に付く                                                                                 |
| `done`                      | issue が 1 件、完了が 7 日より前、ラベル無し、質問無し                                                        |
| `empty`                     | `yaru init` だけ                                                                                              |

質問は `.yaru/questions/` にあり、その中の `.gitignore` が `*` なので git には入らない (`src/questions.ts:599-605`)。issue とコメントとイベントは git に入る。

時計は `YARU_NOW=2026-09-28T12:00:00.000Z` に固定する (`src/time.ts:7-20`)。CLI と `yaru serve` の「今」はこの値になる。issue の `createdAt` も、止まった issue の `updatedAt` も、期限切れの `answerBy` も、この同じ時刻から数える。serve には `fixture.env` の `YARU_NOW` を渡す。

`session` は空にする。作るときに `CLAUDE_CODE_SESSION_ID` と `CODEX_SESSION_ID` を外す (`src/provenance.ts:16-34`)。`worktree` には一時ディレクトリの絶対パスが入る (`src/provenance.ts:24`)。バイト列を比べるときは、この `worktree` の値を正規化する。

既定も期限も無い Blocking の質問を作ると、stderr に `warning: question <id> has no --default and no --answerBy` が出る (`src/index.ts:608-612`)。止まる質問なので、この警告は期待どおり。それ以外の質問は `--default` を付け、警告を出さない。

## 板

基準の URL は `/p/<main.slug>/`。以下、これを `/` と書くときはこの接頭辞付きを指す。

### board-list 一覧の既定

- 行き方: `GET /p/<main.slug>/`
- 確かめる点:
  - 見出しは `All issues` と、見えている件数 (`src/client/board/header.tsx:57-62`)。
  - 本体は `#board`。まとまりは状態。空のまとまりは見出しごと出さない (`src/client/board/list-view.tsx:27-28`)。
  - 見出しの順は Backlog、Todo、In Progress、Done、Canceled (`src/store.ts:118` の `STATUSES`、`src/client/view-model.ts:181-182` が `_` を空白にして単語の先頭を大文字にする)。
  - 既定では `oldDone` は無く、`recentDone` と `canceled` はある (`src/issue-order.ts:54-67`, `src/page.ts:100-109`)。
  - 行は優先度の高い順、同じなら id の大きい順 (`src/issue-order.ts:83-84`)。
  - `ship` の期日は危険色で、読み上げに `Overdue:` (`src/components/due-stamp.tsx:26`)。
  - `stale` に `Stale` (`src/components/stale-marker.tsx:15`)。
  - 答え待ちのある行に `?`。複数なら数。期限が未来なら残り時間。expired を含むと危険色 (`src/client/board/awaiting-badge.tsx:19-31`)。
  - 担当の無い行は右端の丸が空 (`src/client/board/issue-row.tsx:79-81`)。
- 1280: 幅の共通の一覧。
- 390: 幅の共通の一覧。`ship` は 2 行目に期限切れの期日と `bug`。

### board-columns 列

- 行き方: `GET /p/<main.slug>/?view=board`
- 確かめる点:
  - 状態の列は issue が無くても出る (`src/client/view-model.ts:115-116`)。
  - 見出しの切り替えで Board が選ばれている (`src/client/board/header.tsx:85-99`)。
  - 状態の列のカードは引きずれる。状態以外のまとまりでは `draggable` が偽 (`src/client/board/board-view.tsx:59`)。
  - 列の上に乗っている間、列は `data-over` (`src/client/board/board-column.tsx:9`)。
  - 別の状態へ落とすと、その状態で保存する (`src/client/board/board-view.tsx:45-50`)。同じ列に落とすと保存しない。
  - 状態の列だけ `+` がある。指の端末 (`hover: none`) では常に見え、マウスでは hover のときだけ (`src/client/board/board-column.tsx:11-12`)。
- 1280: 列は 272px で横に並ぶ。
- 390: 列は画面の 85%。次の列の端が見える。

### board-group-priority 優先度で分ける

- 行き方: Display を開き Grouping の `Priority`。URL は `/?group=priority` (view を変えていなければ)。
- 確かめる点: まとまりは Urgent、High、Medium、Low、No priority。空も出るのは列のときだけ。一覧は空を省く (`src/client/view-model.ts:129-136`, `src/client/board/list-view.tsx:27`)。
- 1280 / 390: 分け方は同じ。列表示 (`view=board`) の幅差は board-columns と同じ。状態で分けていないので、カードに状態の印が出る (`showStatus`, `src/client/board/board-view.tsx:60`)。引きずって状態は変わらない。

### board-group-label ラベルで分ける

- 行き方: `/?group=label`
- 確かめる点: ラベルは code point 順。複数ラベルの issue は最初の 1 つにだけ入る (`src/client/view-model.ts:117-118`)。ラベルの無い issue は `No label`。空のラベルまとまりは出さない。
- 1280 / 390: 分け方は同じ。

### board-group-none 分けない

- 行き方: `/?group=none`
- 確かめる点: 見出し `All issues` は出さない (`src/client/board/list-view.tsx:34`)。列表示では 1 列。
- 1280 / 390: 分け方は同じ。

### board-sort 並べ方

- 行き方: Display の Ordering。`priority` (既定、URL に出ない)、`updated`、`created`、`due` (`src/client/board/display-options.tsx:27-33`)。
- 確かめる点:
  - `due` は期日の早い順。期日の無いものは後ろ (`src/issue-order.ts:87-92`)。
  - `updated` と `created` は新しい順。同じ時刻なら id の大きい順 (`src/issue-order.ts:71-75`)。
  - 選んだ項目は押したまま面が開いている。リンクはページを読み直さずに開く (`src/client/board/display-options.tsx:7`)。
- 1280: 面はボタンの右端にそろう (`align="end"`)。
- 390: 面は帯の下で画面幅いっぱい (`src/client/board/display-menu.tsx:20`)。

### board-completed 終わった issue

- 行き方: Display の Completed issues。`Hide` は `/?completed=hide`、`Past 7 days` は既定なので URL に出ない、`All` は `/?completed=all` (`src/client/board/display-options.tsx:35-41`)。
- 確かめる点:
  - `hide` では `recentDone` と `canceled` が消える。未完了は残る (`src/issue-order.ts:59-60`)。
  - `all` では `oldDone` も見える。
  - 終わった判定は、done なら `completedAt`、canceled なら `canceledAt`。無ければ `updatedAt`。7 日は `COMPLETED_RECENT_DAYS` (`src/issue-order.ts:30`, `63-67`)。
  - `/?status=done` と `/?status=canceled` のとき、サーバーは completed を `all` に固定し、Display から Completed issues が消える (`src/page.ts:100-109`, `src/client/board/display-options.tsx:46-48`)。別の状態へ移った URL には、人が選んでいない `completed=all` を付けない (`src/client/view-model.ts:50-67`)。
- 1280 / 390: 選択肢の文言は同じ。

### board-status-filter 状態で絞る

- 行き方: サイドバーの `Todo`、または 390 の状態チップ。URL は `/?status=todo`。もう一度押すと外れる (`src/client/board/sidebar.tsx:89`)。
- 確かめる点: 見出しが `Todo` と件数。列表示ではその状態の列だけ (`src/client/board/board-view.tsx:29-31`)。件数は絞ったあとの数 (`src/client/app.tsx:114`)。サイドバーの件数は絞る前の全件 (`src/client/board/sidebar.tsx:93`)。
- 1280: 選んだ行がサイドバーで `active`。
- 390: 選んだチップが `active`。サイドバーは無い。

### board-label-filter ラベルで絞る

- 行き方: サイドバーの `bug`。URL は `/?label=bug`。もう一度で外れる。
- 確かめる点: 帯 (390 では上の帯) に外せる札 `bug`。札の読み上げは `Remove label bug` (`src/client/board/filter-chips.tsx:41`)。`ship` と `child` が残り、`spec` (`docs`) は残らない。
- 1280: 札は見出しの帯。
- 390: 札は状態チップの上。サイドバーが無いので、札が外す手段 (`src/client/board/mobile-status-nav.tsx:7-8`)。

### board-assignee-filter 担当で絞る

- 行き方: サイドバーの `Ada`。URL は `/?assignee=Ada`。
- 確かめる点: `spec` だけが残る。札の読み上げは `Remove assignee Ada`。人の並びは `localeCompare` (`src/client/board/sidebar.tsx:144-145`)。空の担当は People に出ない (`filter(Boolean)`)。
- 1280: サイドバーから選ぶ。
- 390: サイドバーが無い。この絞り込みに入るには URL か、1280 で付けたあとに幅を縮める。付いていることは札で分かり、札で外せる。

### board-awaiting 答え待ちで絞る

- 行き方: サイドバーの `Awaiting answer`。URL は `/?awaiting=1`。もう一度で外れる (`src/client/board/sidebar.tsx:72-77`)。
- 確かめる点:
  - 見出しは `Awaiting answer`。
  - 残るのは open か expired の質問が付いた issue (`src/page.ts:111-119`)。fixture では `ship`、`spec`、`stale`、`backlog`。
  - サイドバーの件数は issue の数。Dashboard の件数は質問の数 (`src/client/board/sidebar.tsx:46`, `84`)。
  - 札 `Awaiting answer`。読み上げは `Remove awaiting answer filter`。
- 1280: サイドバーの行が選ばれている。
- 390: サイドバーが無い。URL で開く。札で外せる。状態チップは残る。

### board-search 検索

- 行き方: `/` キー、または検索欄。語は `spec`。URL は `/?query=spec`。
- 確かめる点:
  - 欄は `#q`、`aria-label` は `Search issues` (`src/client/board/search-box.tsx:82-87`)。
  - スクリプトがあるときは、入力から 120ms 後に `replace` で URL を変える (`同 33-36 行`, `src/client/app.tsx:68-70`)。
  - 一致は id、題名、本文の部分一致、大文字小文字を区別しない (`src/store.ts:375-379`)。
  - 0 件なら `No matching issues` と `Clear filters` (`src/client/board/empty-board.tsx:39-54`)。
  - Esc は、390 で広げた欄を畳む (`src/client/board/search-box.tsx:94-98`)。畳んでいない欄では、欄から focus が外れるだけ (`src/client/use-keyboard-shortcuts.ts:148-150`)。
- 1280: 欄は常に見える。空欄の右に `/`。検索語の札は出ない。
- 390: 虫眼鏡で広げる。`Close search` で畳む。畳んだあとも語が残っていれば、上の帯に `“spec”` の札 (`Remove search spec`)。

### board-search-empty 検索が 0 件

- 行き方: `/?query=no-such-issue`
- 確かめる点: `No matching issues` と `Clear filters`。Clear filters は view、sort、group、completed、basePath だけを残す (`src/client/board/empty-board.tsx:43-50`)。
- 1280 / 390: 文言は同じ。390 では検索語の札も出る。

### board-no-open 開いている issue が無い

- 行き方: `GET /p/<done.slug>/`
- 確かめる点: `No open issues` と `Show completed issues` (`src/client/board/empty-board.tsx:24-33`)。リンクは `/?completed=all`。押すと done の issue が出る。
- 1280 / 390: 文言は同じ。390 でも状態チップは出る。

### board-no-issues まだ issue が無い

- 行き方: `GET /p/<empty.slug>/`
- 確かめる点: `No issues yet`。`Press C or click New issue to create one` (`src/client/board/empty-board.tsx:39-58`)。サイドバーに Labels も People も無い (`src/client/board/sidebar.tsx:96`, `110`)。
- 1280 / 390: 文言は同じ。390 の New は文字が `New`。

### board-sidebar-collapse サイドバーを畳む

- 行き方: 1280 で `Collapse sidebar` (`#sidebar-toggle`)。
- 確かめる点: サイドバーが消え、`Open sidebar` (`#sidebar-open`) が出る。もう一度押すと戻る。幅のドラッグは `Resize sidebar` (`src/client/board/sidebar.tsx:131-137`)。幅の記憶は 160px から 280px (`src/ui/document.tsx:9-10`)。
- 1280: 上記。
- 390: サイドバーが無いので、この操作は無い。

### board-select-row 行を選ぶ

- 行き方: 一覧で `j` と `k`。issue 画面は閉じていること。
- 確かめる点:
  - 選んだ行は `aria-selected` と `surface-3` (`src/client/board/issue-row.tsx:16-17`, `48`)。
  - 端では折り返す (`src/client/use-keyboard-shortcuts.ts:135`)。
  - 選んだ行だけが画面内に入る (`scrollIntoView` `nearest`, 同 140 行)。
  - Enter でその issue を開く。ただしリンクやボタンの上の Enter は開かない (同 121-125 行)。
  - issue 画面が開いている間は `j` `k` `c` `x` は効かない (同 18 行のコメント)。
- 1280 / 390: 選択の見た目は同じ。390 では行が高い。

### board-bulk まとめて選ぶ

- 行き方: 板を開き直してから、`button[aria-label="Select #<ship>"]` を押す。または `x`。範囲は Shift を押しながら行を押す (`src/client/use-board-interactions.tsx:132-143`)。メニューを開いたあとの選択に頼らない。
- 確かめる点:
  - 下に `N selected` の帯。ボタンは Status、Priority、Assignee、Labels。Esc か `Clear selection (Esc)` で外れる (`src/client/bulk/bulk-bar.tsx:30-59`)。
  - 帯の読み上げは `1 issue selected` か `N issues selected`。
  - 選んだ行は `data-bulk-selected` (`src/client/board/issue-row.tsx:47`)。
  - 何か選んでいる間、チェックは常に見える。何も選んでいないとき、マウスでは hover だけ、指では常に見える (`src/client/board/bulk-checkbox.tsx:15-17`)。
  - Shift の範囲は、画面に並んだ順で、起点から押した行までを足す (`src/client/state.ts:198-211`)。起点が無ければ押した行が起点。
  - issue 画面が開いている間、帯は出ない (`src/client/use-board-interactions.tsx:342`)。
  - 期日は帯に無い。キーボードの `d` では選べる (`src/client/use-keyboard-shortcuts.ts:39-44`)。
- 1280: ボタンに `S` `P` `A` `L`。
- 390: そのキー表記は無い (`hidden sm:inline`)。ボタンの左右の余白が狭い。下端は safe area の分だけ上がる (`src/client/bulk/bulk-bar.tsx:8-9`)。

### board-context-menu 右クリックのメニュー

- 行き方: 板を開き、`a[data-id=<ship>]` に focus して Shift+F10 (`src/client/use-keyboard-shortcuts.ts:76-81`)。agent-browser では `agent-browser focus "a[data-id=<ship>]"` のあと `agent-browser press Shift+F10`。`click` に右ボタンは無い。入力欄の中の右クリックはメニューにしない (`src/client/use-board-interactions.tsx:125`)。
- 確かめる点:
  - 項目は Status、Priority、Assignee、Labels、Due date、区切り、`Open issue` (ヒント `↵`)、`Create sub-issue`、区切り、`Copy ID`、`Copy link`、`Copy title`、`Copy as Markdown` (`src/client/issue-menu.ts:211-248`)。
  - Status の子は Backlog、Todo、In Progress、Done、Canceled。今の値が選ばれている。
  - Priority は `No priority`、Urgent、High、Medium、Low。
  - Assignee は `Assign to me (<viewer>)`、`Unassign`、区切り、自分以外の人。viewer は `git config user.name` (`src/page.ts:88-89`, `src/client/issue-menu.ts:60-61`)。fixture では Fixture。
  - Due date は Today、Tomorrow、Next week。期日が付いていれば `Remove due date`。期日の子に選択印は付かない (`src/client/issue-menu.ts:200-201`)。
  - Labels はワークスペースにあるラベル。1 つも無い workspace (`done`) では `No labels yet` が押せない (`src/client/issue-menu.ts:254-255`)。
  - コピーのあと、画面下中央に `Copied ID #…` などが約 2 秒 (`src/client/use-board-interactions.tsx:37`, `200`)。失敗すると `Could not copy to clipboard`。
  - 外を押す、スクロール、リサイズ、ウィンドウを離れると閉じる (メニューの実装は `src/client/context-menu/`)。
- 1280 / 390: 項目は同じ。390 では行の 2 行目の上でも、`data-id` の行なら開く。

### board-property-picker キーボードで属性を変える

- 行き方: 行を選んで `s` `p` `a` `l` `d`。まとめて選んでいるときは、その全ての issue (`src/client/use-keyboard-shortcuts.ts:220-236`)。
- 確かめる点:
  - 面の検索欄。ラベルは `Create label "<語>"` で新しいラベルを作れる。期日は `YYYY-MM-DD` のときだけ `Set due date to <日付>`。それ以外は `Type a date as YYYY-MM-DD` で、選んでも保存しない (`src/client/context-menu/property-picker.tsx:95-109`)。
  - 複数 issue のとき、全員が同じ値のときだけ選択印が付く (`src/client/issue-menu.ts:262-265`)。ラベルは全員が持っているものだけが選択印。選ぶと、全員が持っていれば外し、そうでなければ足す (`src/client/issue-menu.ts:167-179`)。
  - 2 件以上を変えると `Updated N issues` (`src/client/use-board-interactions.tsx:227`)。
- 1280 / 390: 面の位置は、開いた行の下に収まるとき下、収まらないとき上 (`src/client/context-menu/property-picker.tsx:35-44`)。

### board-command-palette コマンドパレット

- 行き方: `⌘K` または `Ctrl+K`。入力欄の中でも効く。または `#command-palette-open` (`src/client/use-keyboard-shortcuts.ts:50-54`)。
- 確かめる点:
  - ダイアログの名前は `Command palette`。欄は `Search issues and commands`、placeholder は `Search issues, questions, or commands…` (`src/client/command-palette/command-palette.tsx:88-105`)。
  - 何も打っていないとき、選んでいる issue があれば短い操作 (属性の `Status: …` は出さない)、最近更新した issue 5 件、答え待ち、`Create issue`、`Open dashboard`、`Open inbox`、他のワークスペース (`src/client/command-palette/palette-entries.ts:49-79`)。
  - 語を打つと、題名か番号の部分一致。`#1` や `1` はその id を先頭に、最大 8 件 (同 97-106 行)。
  - 答え待ちは、まだ期限内のものを、期限切れだけの issue より先 (`同 109-121 行`)。
  - ワークスペースは `/api/inbox` が読めたときだけ。失敗しても欄は残る (`src/client/command-palette/command-palette.tsx:43-49`)。
  - 0 件は `No results`。上下で移動、Enter で実行、Esc で閉じる。変換中の Enter では選ばない (同 69-81 行)。
  - issue を開く操作はページを読み直さない。dashboard、inbox、他のワークスペースはページごと移る (`src/client/command-palette/palette-entries.ts:10-13`)。
- 1280: 欄の字は title。
- 390: 欄の字は 16px (`text-base`, 同 113 行)。入口ボタンに `⌘K` は無い。

### board-workspace-switcher ワークスペースの切り替え

- 行き方: 1280 のサイドバー上端 `#workspace-switcher`。
- 確かめる点:
  - 開くと `Workspaces`。各行は `<slug>, N awaiting answer`。今の行は `aria-current="page"` (`src/client/board/workspace-list.tsx:24-38`)。
  - 読み込み中は `Loading…`。失敗は `Could not load workspaces` (同 42-44 行)。
  - 数は答え待ちの質問の数。0 より大きいと primary の色 (同 34-37 行)。
  - 押すと `/p/<slug>/` へページごと移る。
  - 長い名前は、サイドバー幅から 5.5rem を引いた幅で切れる (`src/client/board/workspace-switcher.tsx:13-14`)。
- 1280: ボタンとして出る。
- 390: サイドバーが無いので、このボタンは無い。切り替えは Projects (`/`) かコマンドパレットの Workspaces。

### board-new-from-column 列から新しい issue

- 行き方: `view=board` の Todo 列の `+`。URL は `/?view=board&id=new&new_status=todo` (`src/client/view-model.ts:75-80`)。
- 確かめる点: 新しい issue の状態が Todo。ラベルや担当で絞った板から作ると `new_label` と `new_assignee` が付く。`me` は viewer の名前、`none` は担当なし (`src/page.ts:164-174`, `187-191`)。
- 1280 / 390: URL は同じ。画面の違いは issue-new。

## issue

issue 画面は板の上に重なる `role="dialog"` (`src/client/issue-view.tsx:136-141`)。`aria-modal` は付けない。下の板は `inert` (`src/client/app.tsx:105-109`)。閉じるのは `Close (Esc)` か Esc。Esc のとき欄に focus があれば、まず欄を離れて保存し、次の Esc で閉じる (`src/client/use-keyboard-shortcuts.ts:151-159`)。

### issue-view 既存の issue

- 行き方: `GET /p/<main.slug>/?id=<ship>`
- 確かめる点:
  - タブは `#<id> <題名>` にワークスペース名 (`src/web.tsx:77-80`)。
  - 見えない `h1` は題名。空なら `New issue` (`src/client/issue-view.tsx:143-146`)。
  - パンくずは `Issues`、番号、題名。
  - 右上に `Issue actions` (`…`) と `Close (Esc)`。`…` は右クリックと同じメニュー (`src/client/issue/issue-view-header.tsx:88-96`)。
  - 題名の欄は `Issue title`。離れるとその項目だけ保存 (`src/client/issue-view.tsx:179-188`)。
  - よく変える属性は Status、Priority、Assignee、Due date (`src/client/issue/key-properties.tsx:14`)。
  - 残りは Labels、Parent、Blocks、Blocked by、作業場所、作成と更新 (`src/client/issue/more-properties.tsx:15-16`)。
  - 本文は描いた Markdown。空なら `Add description…`。
  - 子 issue、Relations、答え済みと取り下げの Questions、Commits、Activity、コメント欄。
  - 本文の `#<id>` は issue へのリンク。修飾キーや中ボタンでなければ、ページを読み直さずに開く (`src/client/issue-view.tsx:119-130`)。
- 1280: 右の欄に属性。`Properties` の見出しが出る。
- 390: 1 列。答え待ちは「N questions awaiting answer」にたたみ、押すと開く (`src/client/issue/awaiting-questions.tsx:10-12`)。1280 (`md` 以上) では最初から開いている。

### issue-awaiting 答え待ちが付いている

- 行き方: `/?id=<ship>` と `/?id=<spec>` と `/?id=<stale>` と `/?id=<backlog>`。
- 確かめる点:
  - `ship` は期限付きで、既定が選択肢。選択肢の先頭に `Default` の札。`Use default` は出ない (`src/components/question-card.tsx:87-94`, `169`)。ボタンは `Answer`。
  - `spec` は Blocking と同じ質問が、issue ではカードのまま出る。`Answer` だけ (既定も選択肢も無い)。
  - `backlog` は `Default` の行と `Use default` と `Answer`。placeholder は `Answer` (選択肢が無いとき, 同 144 行)。
  - `stale` は危険色。`Proceeded with default`、`Agent may have moved on`、`Answer anyway`、主なボタン `Dismiss` (同 151-165 行)。
  - 回答欄の `aria-label` は `Answer to Q<id>`。`⌘⏎` で送る。
  - 送ったあとの戻り先は、次の答え待ちのカード。板には取り消しの知らせを出さない (`src/web.tsx:159-160`)。
- 1280: カードは開いている。Answer に `⌘⏎`。ボタンは横並び (`sm:flex-row`)。
- 390: たたまれている。開くのは `button[aria-controls="issue-awaiting-questions"]` (`src/client/issue/awaiting-questions.tsx:30-36`)。開くとボタンは縦。`⌘⏎` の表記は無い。

### issue-questions-settled 答え済みと取り下げ

- 行き方: `/?id=<ship>` の Questions、`/?id=<recentDone>`。
- 確かめる点: 答え待ちでは無い質問は `Questions` に、1 行にたたんで入る (`src/client/issue-view.tsx:258-263`, `src/components/question-card.tsx:58-79`)。開くと本文、既定、答え。時刻は `Answered …` か `Canceled` (`src/components/question-timing.tsx:7-17`)。
- 1280 / 390: カードの中身は同じ。390 の summary は高さが 44px 相当 (`min-h-11`, `sm:min-h-10`)。

### issue-description-edit 説明を編集する

- 行き方: 本文のある issue で `Edit`。または本文を押す。空の説明は `Add description…`。
- 確かめる点:
  - 欄は `#issue-description-editor`、`aria-label` は `Description`、placeholder は `Add description… (Markdown)` (`src/client/issue/description.tsx:67-83`)。
  - `Preview` で描画に戻る。Esc も編集だけを終えて保存し、issue は閉じない (同 76-81 行)。
  - マウス (`hover` と `pointer: fine`) では本文を押すと編集に入る。字を選んでいるときは入らない。指では入らない (同 10-12, 46-58 行)。
  - タスクのチェックは、どちらの幅でもその場で `[ ]` と `[x]` を切り替えて保存する (同 49-52 行)。
  - 新しい issue は編集から始まるが、focus は題名 (同 15 行のコメント)。
- 1280: `Edit` は hover か focus まで薄い (`pointer-fine:opacity-0`)。`Preview` の横に `(Esc)`。
- 390: `Edit` は常に見える (`pointer-fine` が効かない)。`(Esc)` は出ない (`hidden sm:inline`)。

### issue-description-empty 説明が空

- 行き方: 本文を空にして保存した issue。fixture の `stale` は本文が空。
- 確かめる点: `Add description…` のボタン。押すと編集欄。
- 1280 / 390: 文言は同じ。

### issue-new 新しい issue

- 行き方: `New issue`、または `c` か `n` (`src/client/use-keyboard-shortcuts.ts:110-112`)。URL は `/?id=new`。状態で絞っていれば `new_status` が付く。
- 確かめる点:
  - パンくずは `New issue`。見えない見出しも `New issue`。
  - 右は `Create issue`。`…` メニューは無い (`onOpenMenu` は id があるときだけ, `src/client/issue-view.tsx:166`)。
  - 子 issue 以降 (質問、コミット、活動、コメント) は出ない (`src/client/issue-view.tsx:245`)。
  - 属性を変えても、Create まで保存しない (`src/client/use-page-controller.ts:160`)。
  - 題名が空のまま Create すると、サーバーが断り、上に理由が出る。例は `title is required when creating an issue` (`src/store.ts:331`)。このときは Retry では無く Create が残る (`saveRejected` は `saveState` を `idle` に戻す, `src/client/state.ts:158-159`)。
  - 作ったあとは、その id の URL に置き換わり、`new_*` は消える (`src/client/use-page-controller.ts:146-149`, `src/client/view-model.ts:83-89`)。
- 1280: `Create issue` に `⌘⏎`。
- 390: `⌘⏎` は無い。見出しの New は `New`。

### issue-discard 破棄の確認

- 行き方: `/?id=new` を開き、題名の欄に文字を入れる。閉じるのは issue 画面の中の `#drawer-close` (`Close (Esc)`)。390 では issue 画面が板の見出しまで覆うので、見出しの `#mobile-dashboard-link` は押せない (`src/client/issue-view.tsx:141`, `src/css.tsx:298-301`)。1280 ではサイドバーは覆われないので、サイドバーの Dashboard でも同じ確認が出る。
- 確かめる点:
  - 題は `Discard changes?`。新しい issue の説明は `This new issue has not been created yet.` 既存で保存に失敗して残っているときは `Some changes to this issue have not been saved.` (`src/client/use-board-interactions.tsx:324-331`)。
  - ボタンは `Keep editing` (こちらに focus) と `Discard` (`src/components/confirm-dialog.tsx:6-7`, `47-51`)。
  - 題名も説明も空の新しい issue は、属性だけ変えていても聞かない (`src/client/state.ts:214-221`)。
  - 既存の issue は、保存中は聞かない。失敗して `draftDirty` のときだけ聞く。
  - 同じ issue の読み直しでは聞かない (`src/client/use-board-interactions.tsx:146-152`)。
- 1280 / 390: ダイアログは同じ (`max-w-sm`)。

### issue-properties 属性の候補

- 行き方: 各属性の値を押す。キーボードでは issue 画面で `s` `p` `a` `l` `d` がその行の操作を押す (`src/client/use-keyboard-shortcuts.ts:88-96`)。
- 確かめる点:
  - Status は 5 つ。Priority は `No priority` と 4 つ。Assignee は `Assign to me`、`No assignee`、人の名前 (`src/client/issue/property-options.tsx:29`, `50`)。
  - Labels は複数。空なら `Add labels`。新しい語は `Create label "<語>"` (`src/client/issue/more-properties.tsx:58-71`)。
  - Due date は日付の欄 (`src/client/issue/due-date-value.tsx`)。
  - Parent は `No parent` と検索 `Search issues…` (`src/client/issue/parent-value.tsx:30-36`)。変えるボタンの名前は `Change parent`。
  - Blocks が空なら `Add blocked issues`。Blocked by が空で編集できるなら `Add blocking issues`。編集できないなら `None` (`src/client/issue/more-properties.tsx:117`, `144-150`)。
  - 選んだらその項目だけ保存。4xx で断られると、値を戻してその行の下に理由。全体の誤りにはしない (`src/client/use-page-controller.ts:161-162`)。
- 1280: 右の欄で開く。
- 390: 題名の直下 (よく変える 4 つ) と、説明の下 (残り)。

### issue-subissues 子 issue

- 行き方: `/?id=<ship>`
- 確かめる点: `Sub-issues`、終わった割合の棒 `Sub-issues done`、`n/m`、`Add sub-issue`。リンクは `id=new` と `new_parent=<ship>` (`src/client/issue/sub-issues.tsx:26-39`)。子が 0 でも見出しと `+` は出る。
- 1280 / 390: 見出しは同じ。

### issue-relations 関係

- 行き方: `/?id=<ship>` と `/?id=<blocked>`。
- 確かめる点: 見出し `Relations` は関係が無くても出る (`src/client/issue/relations.tsx:8-9`)。`ship` は `Blocks` に `blocked`。`blocked` は `Blocked by` に `ship`。`+` で足す。種類の切り替えが面の上に出る (`src/client/issue/property-picker.tsx:42` の header)。
- 1280 / 390: 見出しは同じ。

### issue-commits コミット

- 行き方: `/?id=<ship>`。id が数字の issue だけ探す (`src/page.ts:135-138`)。
- 確かめる点: メッセージが `#<id>` に触れたコミットと、issue のブランチにあって HEAD に無いコミット (`src/repository.ts:77-80`)。`#1` は `#12` に当たらない (同 88 行)。最大 20。新しい順。上流があるとき、まだ送っていなければ点と `Not pushed` (`src/client/issue/commits.tsx:22-29`)。上流が無いと `pushed` は null で、点も `Not pushed` も出さない (`src/repository.ts:59`, `src/client/issue/commits.tsx:22`)。
- 撮影: fixture は上流を付けない。`Not pushed` は撮らない。コミットの題名と時刻を撮る。
- 1280: 短いハッシュの時刻の隣の補足が見える (`sm:inline`, 同 36 行)。
- 390: その補足は隠れる。題名は 1 行で切れる。

### issue-activity 活動

- 行き方: 状態を変えた `spec`、コメントのある `ship`。
- 確かめる点:
  - 見出し `Activity`。
  - 作成は `created the issue`。状態のイベントが無いときだけ、開始 `started working`、完了 `completed the issue`、取りやめ `canceled the issue` (`src/client/issue/activity-entries.ts:24-28`)。
  - イベントがあると `changed status Todo → In Progress` のような文 (`src/client/issue/activity-entries.ts:84`)。誰が変えたかは行の前に付く。
  - コメントは本文を Markdown で。返信は `replied to <親の id>` (`src/client/issue/activity-comment.tsx:28-29`)。
  - 下に `Comment`。欄は `Comment`、placeholder は `Leave a comment…`。空では送れない (`required`)。失敗すると `data-comment-error` (`src/client/issue/comment-composer.tsx:23-43`)。
- 1280: Comment に `⌘⏎`。
- 390: `⌘⏎` は無い。

### issue-comment-failed コメントの保存に失敗

- 行き方: コメントを送り、サーバーが断る。空は欄の `required` でブラウザが止める。サーバーまで届く失敗は、本文が空と判定されたとき `invalid body: expected a non-empty string, actual ""` (`src/store.ts:666`)。
- 確かめる点: 欄の下に理由。書きかけは残る。フォームの POST (スクリプト無し) は `?error=` と `comment=` を付けて issue に戻る (`src/web.tsx:394` のコメント)。
- 1280 / 390: 理由の位置は同じ。

### issue-missing 無い issue

- 行き方: `GET /p/<main.slug>/?id=999` (fixture に無い id)。
- 確かめる点:
  - HTTP は 404。板は描く。`current` は空 (`src/web.tsx:704-716`, `src/page.ts:153-182`)。
  - 文言は `issue not found: 999`。板の上に浮く Alert。約 8 秒で消える。Retry は付かない (`requestRetryable` は読み込み失敗のときだけ, `src/client/use-board-interactions.tsx:277-282`, `350-358`)。
  - 閉じると誤りは消える (`errorDismissed`)。
  - ファイルが壊れているなど、`issue not found:` 以外は隠さず 400 か 404 のエラー画面 (`src/page.ts:154`, `src/web.tsx:93-95`)。
- 1280 / 390: Alert は上端。390 では左右に 0.75rem (`src/components/alert.tsx:31`)。1280 では右寄せで最大幅あり (`sm:left-auto sm:max-w-md`)。

### issue-save-states 保存の表示

- 行き方: 既存 issue の題名を変えて欄を離れる。
- 確かめる点:
  - 送っている間 `Saving…`。成功は `Saved`。約 2 秒で消える (`src/client/use-page-controller.ts:37-38`, `src/client/issue/issue-view-header.tsx:68-75`)。
  - 撮影しない: `Saving…` は localhost では応答と同じターンで消える。agent-browser の route は通信を止めるか本文を返すだけで、応答を遅らせてこの表示を残せない。`Unsaved` と `Saved` は撮る。
  - 打っている途中で、まだ送っていないときは `Unsaved`。このときは Retry は出ない (同 14-15 行のコメント)。
  - スクリプトが無いときだけ `Save` ボタン (`noscript`, 同 83-87 行)。
- 1280 / 390: 文言は同じ。

### issue-save-rejected 項目を断られた

- 行き方: 期日に日付でない値を保存させる。CLI の形は `invalid dueDate: expected YYYY-MM-DD, actual <値>` (`src/store.ts` の `resolveDueDate`)。
- 確かめる点: その項目の下に理由。値は保存済みに戻る。上の Alert には出さない (`src/client/use-page-controller.ts:183-185`)。
- 1280 / 390: 行の下。

### issue-save-failed 保存が届かない

- 行き方: 既存 issue で題名を変え、離れる瞬間に通信を切る (撮影スクリプトは `offline on`)。
- 確かめる点:
  - 見出しは `Unsaved` と `Retry` (`src/client/issue/issue-view-header.tsx:77-80`)。
  - 上の Alert に `Failed to fetch` (`src/client/use-page-controller.test.tsx` がこの文言を期待する)。Retry は付かない (`requestRetryable` は false, `src/client/state.ts:161-162`)。閉じるボタンで Alert は消せる。
  - 手元の題名は残る。つながり直すと 1 度だけ自動で送り直す。新しい issue は自動では作らない (`src/client/use-page-controller.ts:253-261`)。
  - 閉じようとすると破棄の確認が出る。
- 1280 / 390: ボタンの位置は同じ。

### issue-load-failed 板の読み込みに失敗

- 行き方: 開いている板で、読み直しの通信を切る。
- 確かめる点: issue を開いていないとき、浮く Alert に理由と `Retry`。Retry は同じ URL を読み直す (`src/client/use-board-interactions.tsx:354-358`)。約 8 秒で消える。issue を開いている間は、浮く Alert にはせず、issue の上の Alert に出す (`floatingError` は `current` が空のときだけ, 同 278 行)。
- 1280 / 390: Alert の幅は issue-missing と同じ。

## Dashboard

`GET /p/<main.slug>/dashboard`。板のハイドレーションは無く、フォームと inline script (`src/dashboard.tsx:33`)。

### dashboard-main 進み具合

- 行き方: 上記 URL。サイドバーの Dashboard、または 390 の数のチップ、またはパレットの `Open dashboard`。
- 確かめる点:
  - パンくずは `Projects`、`<slug>`、`Dashboard` (`src/dashboard.tsx:114-122`)。`<slug>` は板へ、`Projects` は `/` へ。
  - 札は Awaiting answer、Expired、In progress、Overdue (`src/dashboard.tsx:127-151`)。0 より大きい Awaiting は `#questions`、Expired は `#proceeded`、In progress は `#in-progress`、Overdue は `#overdue` へ。0 の札はリンクにならない。
  - 質問のまとまり (`src/components/awaiting-question-list.tsx:41-49`):
    - `Blocking` / `The agent is stopped until you answer` (`spec` の質問)
    - `Due soon` / `The default applies at the deadline` (`ship` の質問)
    - `No deadline` / `Has a default, no deadline` (`backlog` の質問)
    - `Proceeded with default — override?` / `The agent moved on with the default` (`stale` の質問)。1 行にたたみ、開くと Dismiss と Answer anyway
  - 空のまとまりは見出しごと出さない。
  - `In progress` に `spec` と `stale`。`stale` は Stale の札 (`showStale`)。0 件なら `Nothing in progress`。
  - `Overdue` は期限切れの未完了だけ。done と canceled は入らない (`src/components/due-stamp.tsx:5` のコメント、`src/issue-dates.ts`)。fixture では `ship`。0 件なら節ごと出さない (`src/dashboard.tsx:161`)。
  - `Commits` にブランチ名、`no upstream`、未コミットがあれば `N uncommitted files` (`src/dashboard/repository-section.tsx:18-36`)。コミット 0 なら `No commits yet`。
  - `Agent sessions`。fixture には Claude Code のセッションが無いので `No Claude Code sessions in the last <windowDays> days` (`src/dashboard/sessions-section.tsx:29`)。`windowDays` の数は `src/sessions.ts` が決める。
  - `Recently answered` に答え済みの質問。最大 10、`answeredAt` の新しい順 (`src/dashboard.tsx:76-79`)。取り下げはここには出ない。
  - 読み直すボタン `#page-refresh` は最初は隠れている。書きかけの回答が無いとき、変更があれば自分で読み直す。書きかけがあるときは `N new — Show` か `Updated — Show` (`src/ui/live-page.ts:148-157`, `src/ui/page-header.tsx:14`)。
- 1280: 札は 4 列 (`sm:grid-cols-4`, `src/components/stat-grid.tsx:6`)。サイドバーで Dashboard が選ばれている。
- 390: 札は 2 列。サイドバーは無い。ロゴは `/` へ (`src/ui/page-header.tsx:31`)。質問カードのボタンは縦。

### dashboard-empty-questions 質問が無い

- 行き方: `GET /p/<done.slug>/dashboard` または empty。
- 確かめる点: `No questions awaiting an answer` (`src/components/awaiting-question-list.tsx:60`)。Awaiting と Expired は 0。Recently answered は出ない。done の workspace は In progress が `Nothing in progress`。Overdue の節は無い。
- 1280 / 390: 文言は同じ。札の列数だけ違う。

### dashboard-answer 答える

- 行き方: Blocking のカードに文を書いて `Answer`。または選択肢を押す。または `Use default`。
- 確かめる点:
  - 成功は 303 で dashboard に戻る。次のカードの fragment へ。`answered=<id>` が付く (`src/web.tsx:159-167`)。
  - `Use default` の保存される本文は `Go with the default action: ` に既定を足したもの (`src/dashboard.tsx:60`, `src/web.tsx:140-142`)。
  - 選択肢を押した答えは、その選択肢の文言。
  - 空の回答は、カードに理由が戻る。`invalid answer: expected a non-empty string` を含む (`src/web.test.ts:647-659`)。書きかけは `answer=`。どの質問かは `q=`。
  - 戻り先は、この workspace の板か dashboard か `/inbox` だけ。それ以外は dashboard (`src/web.tsx:674-690`)。
  - 書きかけが URL に乗らないほど長いときは、理由だけ戻る。上限は符号化して 8000 (`src/web.tsx:753-760`)。
- 1280 / 390: 成功後の移動は同じ。390 はボタンが縦。

### dashboard-undo 答えたあとの取り消し

- 行き方: dashboard で答えた直後。`?answered=<id>`。
- 確かめる点:
  - 下に `Answered Q<id>` と題名と `Undo` (`src/components/answer-undo-toast.tsx:31-55`)。
  - 取り消せるのは `undoAnswerDeadline` まで。長さは答えてから 30 秒 (`src/questions.ts:247`)。エージェントが受け取った (`acknowledgedAt` がある) 答えは Undo が無く、知らせは 5 秒 (`src/ui/answered-toast.tsx:9`, `23-27`)。
  - 期限を過ぎてから開くと知らせは出ない (同 27 行)。
  - Undo は答えを消し、その文を `answer=` でカードに戻す。`Use default` と選択肢の答えは欄に戻さない (`src/web.tsx:171-172`, `732-736`)。
  - 別の更新とぶつかると、答えを消さずに理由を戻す (`src/components/answer-undo-toast.tsx:7`)。
  - 読み上げ用の文は、読み込んだあと script が入れる (`data-announce`, 同 11-12 行)。
  - 知らせが出ている間は、自動の読み直しを待つ (`src/ui/live-page.ts:138-141`)。
- 1280 / 390: 下端の中央。左右の余白と safe area は同じ (`src/components/answer-undo-toast.tsx:36`)。

### dashboard-returned-missing 戻った質問がもう無い

- 行き方: `?q=<id>&error=<理由>` で、その質問が答え待ちに無い。
- 確かめる点: 理由はカードの中では無く、画面の上の Alert (`src/dashboard.tsx:92-97`, `126`)。
- 1280 / 390: Alert は同じ。

## Projects

`GET /`。`yaru serve` の入口 (`src/web.tsx:502-504`)。

### projects-list ワークスペースの一覧

- 行き方: `GET /`
- 確かめる点:
  - パンくずは `Projects`。ロゴは押せない (`home`, `src/projects.tsx:28`)。
  - 先頭に Inbox。説明は `Every workspace's questions, most urgent first`。数は全部の答え待ち (`src/projects/inbox-link.tsx:16-24`)。0 より大きいと primary。
  - 各カードに slug、`N awaiting`、`N in progress`、フォルダのパス (`title` に全体)。答え待ちの質問が急ぐ順に並ぶ。リンクは `/p/<slug>/dashboard#q-<id>` (`src/projects/project-card.tsx:39-48`)。
  - Blocking (open で既定が無い) があると、カードの左に危険の帯 (`同 14-16 行`)。
  - ボタン `Issues` と `Dashboard` は同じ重さ (同 8 行のコメント)。
  - 30 秒ごとに `location.reload()` (`src/projects.tsx:45`)。
- 1280 / 390: カードは 1 列。ボタンは 2 列のまま (`grid-cols-2`)。390 でも札の文は見える。

### projects-empty ワークスペースが無い

- 行き方: `YARU_STATE_DIR` が空のディレクトリで `yaru serve` し、起動した場所がワークスペースで無いこと (`src/index.ts:353-355` は workspace なら登録する)。
- 確かめる点: `No workspaces yet. Run yaru in a workspace to add it here.` (`src/projects.tsx:30`)。Inbox のリンクは出ない。
- 1280 / 390: 文言は同じ。

## Inbox

`GET /inbox`。複数ワークスペースを配る `createServerApp` だけが持つ (`src/web.tsx:508`)。

### inbox-main 受信箱

- 行き方: `/inbox`。Projects の Inbox、またはパレットの `Open inbox`。
- 確かめる点:
  - パンくずは `Projects`、`Inbox`。
  - まとまりの名前は dashboard と同じ。ワークスペースを混ぜてから分ける (`src/inbox-page.tsx:16`)。
  - カードにワークスペース名。押すとその dashboard の質問へ (`workspace.href`)。
  - issue のリンクは番号だけ。受信箱は題名を読まない (`src/inbox-page.tsx:40-41`)。
  - カードの id はワークスペース名を挟む (`src/inbox-page.tsx:18` のコメント)。
  - 答えは、その質問のワークスペースへ送り、`returnTo=/inbox` で戻る。
  - 空なら `No questions awaiting an answer in any workspace` (`src/inbox-page.tsx:69`)。
  - 30 秒ごとに `/api/inbox` を見る (`src/web.tsx:47-48`, `540-546`)。
- 1280 / 390: サイドバーは無い (PageShell に sidebar を渡していない)。390 はカードのボタンが縦。

### inbox-answer-undo 受信箱で答えると取り消す

- 行き方: inbox で答える。戻りは `?answered=<id>&workspace=<slug>`。
- 確かめる点: 知らせは dashboard と同じ部品。Undo の送り先は、その質問のワークスペースの `/questions/<id>/undo` (`src/components/answer-undo-toast.tsx:21-22`)。失敗して質問がもう答え待ちに無いときは、上の Alert (`src/inbox-page.tsx:64`)。
- 1280 / 390: 知らせの位置は同じ。

## 誤りと知らせ

### error-not-found 知らない URL

- 行き方: `GET /no-such-page`
- 確かめる点: 404。中央に `not found` と `back`。`back` は `/` (`src/ui/error-view.tsx:7-16`, `src/web.tsx:493-499`)。
- 1280 / 390: 中央。左右に余白。上端は safe area。

### error-workspace 知らないワークスペース

- 行き方: `GET /p/no-such-workspace/`
- 確かめる点: 404。`workspace not found: no-such-workspace` (`src/web.tsx:565-572`)。`back` は `/`。
- 1280 / 390: error-not-found と同じ配置。

### error-inside-workspace ワークスペースの中の失敗

- 行き方: ワークスペースの中で、`not found` を含まない失敗。例は壊れたクエリ `/?sort=nope`。`invalid sort: expected priority, updated, created, or due, actual "nope"` (`src/issue-order.ts:114-116`)。
- 確かめる点: 状態は 400 (`not found` を含むときだけ 404, `src/web.tsx:93`)。中央にその文と `back`。`back` はそのワークスペースの板 (`src/web.tsx:72-75`)。
- 1280 / 390: 配置は error-not-found と同じ。

### error-conflict 質問の衝突の HTML

- 行き方: フォームの回答、取り下げ、取り消しは、失敗しても 303 で理由を戻す (`src/web.tsx:149-156`)。捕捉されない `QuestionConflictError` だけが 409 の ErrorView (`src/web.tsx:87-91`)。
- 確かめる点: 409 のとき文は衝突の理由。API は JSON で `error` と `question`。
- 1280 / 390: ErrorView の配置。
- 撮影しない: フォームの回答、取り下げ、取り消しは失敗しても 303 で理由を戻す (`src/web.tsx:149-156`)。409 の HTML は、捕捉されない `QuestionConflictError` だけ (`src/web.tsx:87-91`)。画面の操作だけではその HTML に着かない。

### notice-copy コピーの知らせ

- 行き方: メニューの Copy ID。
- 確かめる点: `Copied ID #<id>`。他は `Copied link to #<id>`、`Copied title of #<id>`、`Copied #<id> as Markdown` (`src/client/issue-menu.ts:228-247`)。約 2 秒。live region は知らせが無いときも残る (`src/components/notice.tsx:2-3`)。
- 1280 / 390: 下端中央。`whitespace-nowrap` なので、長い文は幅を超える。390 で題名が長いと、はみ出す。はみ出しを切るか折り返すかはソースが決めていない (未決)。

## ライブ更新と書きかけ

板は `/events` の SSE を受け、80ms 後に今の URL を `preserveDraft` で読み直す (`src/client/use-page-controller.ts:88-111`)。読み直しは `mergeDraft` で、手元で変えた項目だけを残す (`src/client/state.ts:88-96`, `302-309`)。接続が切れて戻り直したときと、`online` のときは、同じ読み直しをする (`src/client/use-page-controller.ts:97-107`)。

dashboard と inbox は preact では無く、`live-page.ts` が SSE か一定間隔の読み取りと、`sessionStorage` の書きかけを持つ。

### board-live-draft 編集中の読み直し

- 行き方:
  1. `GET /p/<main.slug>/?id=<ship>` を開く。
  2. 題名の欄に、保存せず「Local title only」と入れる。`input` だけを出し、欄から離れない (`src/client/issue-view.tsx:183-185`)。離れると保存される。
  3. 別のプロセスで `yaru issue save --id <ship> --priority low` を実行する。`.yaru` の変更で SSE が飛び、板が読み直す。
- 確かめる点: 題名は「Local title only」のまま。優先度はサーバーの Low になる。他の項目は読み直した値 (`src/client/state.ts:302-309`)。
- 1280 / 390: 残し方は同じ。属性の位置は issue-view と同じ。
- 撮影: この操作はファイルを変える。撮る前に fixture の写しを取る。

### board-live-online 切れてから戻り直す

- 行き方:
  1. `GET /p/<main.slug>/` を開く。
  2. ブラウザを offline にする。CDP の `Network.emulateNetworkConditions` で `offline: true`。agent-browser では `agent-browser set offline on` (トップレベルの `offline` コマンドは無い)。
  3. CLI で別の issue の題名を「Renamed while offline」に変える。
  4. offline のまま、題名が「Backlog idea」のままで、「Renamed while offline」が無いことを確かめる。
  5. `agent-browser set offline off` で戻す。`online` と、SSE の `onopen` が読み直す (`src/client/use-page-controller.ts:99-107`)。
- 確かめる点: offline の間は古い題名のまま。戻したあとに「Renamed while offline」が出る。
- 1280 / 390: 文言は同じ。
- 撮影: 写しの上で行う。

### dashboard-draft inbox-draft 書きかけの答え

- 行き方:
  1. dashboard を開く。Blocking の回答欄 (`textarea[form="answer-question-<blocking>"]`) に「draft text」と入れる。
  2. ページを読み直す。
  3. inbox でも、`textarea[form="answer-question-<slug>-<blocking>"]` に入れて読み直す。
- 確かめる点: 読み直したあとも、同じ欄に「draft text」が戻る。鍵は `sessionStorage` の `yaru.drafts:<basePath>/dashboard` と `yaru.drafts:/inbox` (`src/web.tsx:454`, `546`, `src/ui/live-page.ts:71-100`)。空の欄だけを戻し、`?answer=` でサーバーが埋めた欄は上書きしない (同 92-98 行)。送ると、その質問の書きかけは消える (同 115-123 行)。
- 1280 / 390: 欄の位置は質問カードと同じ。
- 撮影: dashboard と inbox は、幅ごとに別のブラウザセッションで開く。同じセッションだと、dashboard の `sessionStorage` があとの dashboard の撮影に残る。

### dashboard-show-new 新しい質問の知らせ

- 行き方:
  1. dashboard を開き、回答欄に文字を入れる。入力中は自動で読み直さない (`src/ui/live-page.ts:139-157`)。
  2. CLI で新しい open の質問を足す。SSE が `/events` に飛び、`/api/questions` を読み直す (`src/ui/live-page.ts:174-186`)。
- 確かめる点: `#page-refresh` が現れ、文字は `1 new — Show`。押すと読み直す。入力が無ければ、ボタンを出さずにそのまま読み直す (同 149-152 行)。
- 1280 / 390: ボタンは見出しの右 (`src/ui/page-header.tsx:44-48`)。
- 撮影: 写しの上で行う。

### dashboard-show-updated 更新の知らせ

- 行き方: 回答欄に文字を入れたまま、CLI で issue を保存する。質問の顔ぶれは増えない。
- 確かめる点: ボタンの文字は `Updated — Show` (`src/ui/live-page.ts:167-171`)。質問の取得に失敗したときも同じ文 (同 184-186 行)。
- 1280 / 390: ボタンの位置は同じ。
- 撮影: 写しの上で行う。inbox は 30 秒ごとの `/api/inbox` で同じ文を出す (`src/web.tsx:47-48`, `src/ui/live-page.ts:188-200`)。撮影は dashboard の SSE で見る。

### dashboard-relative-time 相対時刻

- 行き方: dashboard を開いたまま 1 分待つ。撮影は、ページを開く前に入れた時計を 65 秒進めて、同じ書き換えをすぐ走らせる。
- 確かめる点: `time[data-relative]` の文字が、ブラウザの今で書き換わる (`src/ui/live-page.ts:204-215`)。間隔は 60 秒。ブラウザの `Date` は `YARU_NOW` に、実際の経過時間を足したもの。
- 1280 / 390: 文字は同じ。

### dashboard-deadline-passed 期限を過ぎた促し

- 行き方: 期限が未来の open の質問 (`data-answer-by`) を開いたまま、その時刻を過ぎてから 1 分待つ。撮影は、同じ時計を 8 日進めて、毎分の判定をすぐ走らせる。
- 確かめる点: `#page-refresh` の文字が `Deadline passed — Show` (`src/ui/live-page.ts:210-213`)。`data-answer-by` は、期限切れでは無く、期限が未来の open だけに付く (`src/components/question-card.tsx:104`)。
- 1280 / 390: ボタンの位置は dashboard-show-new と同じ。
- 撮影: 回答欄に文字を入れてから、入れた時計を 8 日進める。入力が無いと `announceChange` はボタンを出さずにページを読み直す (`src/ui/live-page.ts:149-152`)。読み直したサーバーの時計は `YARU_NOW` のままなので、ボタンは出ない。ファイルの `answerBy` は変えない。

### dashboard-fragment-proceeded 閉じた Proceeded を開く

- 行き方: Projects のカードから、期限切れの質問のリンク `/p/<slug>/dashboard#q-<id>` を開く (`src/projects/project-card.tsx:45`)。
- 確かめる点: Proceeded は `details` で閉じている (`src/components/awaiting-question-list.tsx:111-116`)。fragment の先がその中なら、`live-page.ts` が `open` にしてからその位置へ流す (`src/ui/live-page.ts:237-250`)。題名 `Ship the fallback?` が見える。
- 1280 / 390: 開き方は同じ。

### dashboard-dismiss issue-dismiss inbox-dismiss 取り下げ

- 行き方: 期限切れのカードの `Dismiss` を押す。dashboard、`/?id=<stale>` の issue、`/inbox` のそれぞれ。ボタンは `form="cancel-question-..."` (`src/components/question-card.tsx:157-164`, `src/components/question-answer.ts:34-36`)。inbox の form id は `cancel-question-<slug>-<id>`。
- 確かめる点: 成功すると 303 で同じ画面に戻る (`src/web.tsx:196-217`)。その質問は答え待ちから外れる。issue では Questions のたたんだ行になる。
- 1280: ボタンは横並び。
- 390: ボタンは縦。
- 撮影: 質問を消すので、画面ごとに写しを取る。

### dashboard-dismiss-failed 取り下げの失敗

- 行き方:
  1. 期限切れの `Dismiss` が見えている画面を開く。
  2. 読み直す前に、CLI でその質問に答える (`yaru question answer`)。状態は answered になる。
  3. まだ残っている `Dismiss` を押す。
- 確かめる点: サーバーは `cannot cancel question <id>: expected status open or expired, actual answered` で断り (`src/questions.ts:338-342`)、303 で `error` を戻す (`src/web.tsx:203-214`)。dashboard と inbox では上の Alert。issue では issue の上の Alert。すでに canceled の質問をもう一度取り下げるのは、エラーにせずそのまま返す (同 337 行)。
- 1280 / 390: Alert の位置は各画面の失敗と同じ。
- 撮影: 写しの上で行う。issue と inbox も同じ手順。

## サイドバーと属性の面

### dashboard-sidebar サイドバーの開閉

- 行き方: 1280 で dashboard を開く。`#sidebar-toggle` (`Collapse sidebar`) を押す。続いて `#sidebar-open` (`Open sidebar`) を押す。
- 確かめる点: 畳むと `html[data-sidebar="closed"]` で `#sidebar` が消え、768px 以上で `#sidebar-open` が `display: grid` になる (`src/css.tsx:156-162`)。dashboard では preact の onClick が無いので、`live-page.ts` が同じ localStorage の鍵 `yaru.sidebar.open` を書く (`src/ui/live-page.ts:253-267`)。板と dashboard で開閉は揃う。
- 1280: 上記。
- 390: サイドバーは元から無い。この操作は無い。
- inbox は `PageShell` にサイドバーを渡していない (`src/inbox-page.tsx:59-62`)。開閉は無い。

### issue-relation-kind 関係の種類

- 行き方: `/?id=<ship>` で `Add relation` を押す。面の `Blocks` を押す。
- 確かめる点: 面の上に `role="group"` の `Relation`。`Blocked by` と `Blocks`。押した方は `aria-pressed="true"` (`src/client/issue/relation-kind-switch.tsx:22-31`)。候補の名前が `Blocks` に変わる (`src/client/issue/relation-picker.tsx:24`)。issue を選ぶまで保存しない。
- 1280 / 390: 面の中は同じ。

### issue-labels-multi ラベルを複数選ぶ途中

- 行き方: `/?id=<stale>` (ラベルが無い) で Labels の `Add labels` を押す。`bug` を押す。
- 確かめる点: 複数選択なので面は開いたまま (`src/client/issue/property-picker.tsx:9`)。`bug` の `aria-selected` が true。押した時点でその項目は保存される (`src/client/issue/more-properties.tsx:60`)。
- 1280 / 390: 面の位置は属性の欄に従う。
- 撮影: 保存するので写しの上で行う。

### issue-parent-empty 親の検索が 0 件

- 行き方: 親の無い issue (`stale`) で `Set parent` を押す。検索欄に `zzzz-no-such` と入れる。
- 確かめる点: 候補は 0 件で `No results` (`src/components/combobox.tsx:31`, `144-145`)。placeholder は `Search issues…` (`src/client/issue/parent-value.tsx:36`)。親は新しい値を作れないので、`Create` は出ない。
- 1280 / 390: 文言は同じ。

## 撮影で触れないもの

次は画面の状態ではあるが、fixture だけでは再現しない。手順だけ書く。

- セッションの数字と行 (`src/dashboard/sessions-section.tsx:32-67`)。Claude Code のセッションファイルが要る。中身の形は `src/sessions.ts`。fixture は空の案内だけを作る。
- 上流があるときの `N not pushed` と `N behind` (`src/dashboard/repository-section.tsx:22-31`)。fixture は上流を付けないので `no upstream`。
- `detached HEAD` はブランチ名が取れないとき (同 19 行)。
- コマンドパレットの `Switch to <slug>` は、inbox API が返す他の workspace。fixture の 3 つで再現できる。
- PWA の manifest とアイコン、フォントは画面の状態では無くファイルの配信 (`src/web.tsx:249-250`)。入口の一覧は P0-routes の担当 (`docs/migration/PLAN.md:38`)。

## 未決

仕様として決めない。ソースから一意に読めなかったもの。

1. `createApp` (接頭辞が空、ワークスペース名 `yaru`、切り替えボタン無し、dashboard のパンくずが `Issues`) はテストと単体のアプリにある (`src/page.ts:85-86`, `src/client/board/workspace-switcher.tsx:37-38`, `src/dashboard.tsx:115-121`)。`yaru serve` は `createServerApp` だけを起動する (`src/index.ts:350-356`)。Go の画面が接頭辞の空いた配り方を持つかは、このソースだけでは決まらない。
2. 409 の ErrorView に、画面の操作だけで到達する手順が無い。フォームは 303 で理由を戻す。
3. コピーの知らせは `whitespace-nowrap` で、390 で長い題名がはみ出すときの折り返しが無い (`src/components/notice.tsx:14`)。
4. 確認幅の高さはソースに無い。撮影は 800 と 844 を仮に使う。
5. `?assignee=me` と `?assignee=none` は、一覧のフィルタでは文字としての一致 (`src/store.ts:372-373`)。`me` を viewer に読み替えるのは、新しい issue の初期値と、保存のときだけ (`src/page.ts:186-191`)。サイドバーは人の名前しか出さない。`me` で絞る画面の操作は無い。
6. まとめて選ぶ帯に Due date が無く、キーボードの `d` にはある (`src/client/bulk/bulk-bar.tsx:11-16`, `src/client/use-keyboard-shortcuts.ts:39-44`)。意図した差か、欠落かはソースが説明していない。
7. 上流が無いコミットの `pushed` は null で、画面の三項は `Not pushed` と出す (`src/repository.ts:59`, `src/client/issue/commits.tsx:24`)。`no upstream` の札と「送っていない」が同時に出る。言葉を変えるかは決めていない。
8. セッションが 0 の文の日数は、fixture を作るスクリプトがセッションファイルを書かないので、撮影では空の文だけを見る。日数の期待値は `src/sessions.ts` を別途読むこと。
9. 板のメニューは Shift+F10 で開く。`agent-browser click` に右ボタンは無い。画面端でのメニュー位置 (`src/client/issue-menu.ts:276` 以降の `clampMenuPosition`) は、ポインタの座標で右クリックしたときのもので、この撮影では撮らない。
