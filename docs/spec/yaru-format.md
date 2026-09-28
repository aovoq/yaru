# .yaru の形式

Go が `.yaru` を読み書きしたとき、今の TypeScript 版とファイルのバイト列が同じになるための仕様。根拠は `src/` と、そのテスト、およびこの worktree のソースを一時ディレクトリで動かして得たファイル。本物の `.yaru` と `~/.local/state/yaru` は見ていない。

この worktree の `src/time.ts` に `YARU_NOW` は無い。時刻を外から固定する入口は、関数ごとに「時刻」で書く。

意図がソースから決まらないもの、今の実装が壊れて見えるものは、本文で契約にせず、末尾の「未決」に置く。未決の項目は、Go 側でより良く直さない。

例に出てくる `Spec Author` は、その実行で `git config user.name` が返した名前である。

## バイト列

- 文字コードは UTF-8。書き出しは `writeFileSync` に文字列を渡している (`src/store.ts:778`, `src/store.ts:783`, `src/questions.ts:605`)。BOM は付けない。
- 書き出す改行は LF (`\n`) だけ。CRLF にはしない。
- Markdown を読むときは、先に全文の `\r\n` を `\n` に置換する (`src/store.ts:788`)。単独の `\r` は残る。
- 不正な UTF-8 の扱いは、Node の `utf8` デコーダ任せである。Go の置換文字と揃えるかは未決。

## ディレクトリ

ワークスペースの印は `<root>/.yaru/config.yml` が存在すること (`src/store.ts:125`, `src/store.ts:163`)。中身が 0 バイトでも印になる。

`init(root)` が作るもの (`src/store.ts:167-173`):

| パス               | 中身             |
| ------------------ | ---------------- |
| `.yaru/issues/`    | 空のディレクトリ |
| `.yaru/comments/`  | 空のディレクトリ |
| `.yaru/config.yml` | 0 バイト         |

`init` は `events/` と `questions/` を作らない。プレースホルダ (`.keep` など) も書かない。

CLI の `yaru init` は `init` のあとに `ensureQuestionsDirectory` と `registerWorkspace` を呼ぶ (`src/index.ts:344-346`)。そのため CLI の初期化だけ、次もできる。

| パス                         | 中身                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `.yaru/questions/`           | ディレクトリ                                                                   |
| `.yaru/questions/.gitignore` | `*\n` の 2 バイト。既にあるファイルは上書きしない (`src/questions.ts:601-606`) |

それ以外のパスは、最初に必要になったときに作る。

| パス                      | 作るタイミング                                                                          | ファイル名   |
| ------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| `.yaru/issues/<id>.md`    | issue の作成 (`src/store.ts:307`, `src/store.ts:767-768`)                               | `<id>.md`    |
| `.yaru/comments/<id>.md`  | コメントの作成。ディレクトリもここでも作る (`src/store.ts:686`, `src/store.ts:721-722`) | `<id>.md`    |
| `.yaru/events/<id>.jsonl` | 追跡する属性が変わったとき (`src/issue-events.ts:57-62`, `src/issue-events.ts:81-82`)   | `<id>.jsonl` |
| `.yaru/questions/<id>.md` | 質問の作成 (`src/questions.ts:609-610`)                                                 | `<id>.md`    |

サブディレクトリは読まない。`readdirSync` の直下だけを見る (`src/store.ts:180`, `src/store.ts:710`, `src/questions.ts:631`)。名前が `.md` で終わるものだけを文書として読む。大文字の `.MD` は対象外。ディレクトリ名が `.md` で終わっていても、読み取りに失敗したファイルは一覧から省く。

issue・コメント・質問の id 空間は別である。どちらも `1.md` を持てる。

## 採番

issue・コメント・質問は、それぞれのディレクトリで同じ規則 (`src/store.ts:356-367`, `src/store.ts:725-736`, `src/questions.ts:613-624`)。

1. ディレクトリが無ければ最大は 0。
2. 直下の名前のうち `^(\d+)\.md$` に合うものだけを見る。
3. キャプチャを `Number` (IEEE 754) にして、最大を取る。
4. 次の id は `String(最大 + 1)`。ゼロ埋めしない。欠けた番号は再利用しない。frontmatter の `id` は見ない (`src/store.test.ts:125-142`)。

`01.md` は数値 1 として最大の計算に入る。ただし読むときの id はファイル名の幹で、文字列 `"01"` のままである (`src/store.ts:771-774`)。作成 API が作る id は `"1"`, `"2"` のような十進表記だけである。

作成は `writeFileSync(path, text, { flag: "wx" })` (`src/store.ts:777-778`)。既にあれば `EEXIST` のときだけ採番からやり直す (`src/store.ts:300-312`, `src/store.ts:1029-1031`)。回数の上限は無い。

`saveIssue({ id })` でファイルが無い場合は作らず、`issue not found: <id>` を投げる (`src/store.ts:263-264`, `src/store.test.ts:119-122`)。コメントと質問も同じ (`src/store.ts:654-657`, `src/questions.ts:128-129`)。

数字以外の幹 (`notes.md` の id は `notes`) は、ファイルがあれば読める (`src/page.test.ts:167-172`)。作成 API はその名前を発行しない。

`Number` が精度を失う桁の id は未決。

## 共通の frontmatter

YAML のライブラリは使わない。issue・コメント・質問は、次の自前の読み書きだけを通る。

### 書く

`formatDocument` (`src/store.ts:861-867`):

1. 各フィールドは、値が `""` なら `key:` 。それ以外は `key: ` (コロンの直後に半角スペース 1 つ) と値を連結する。
2. 引用符、エスケープ、折返しは付けない。値に含まれる文字はそのまま出る。
3. フィールドの間は LF。
4. 全体は `---\n` + フィールド + `\n---\n\n` + 本文 + `\n`。

空の本文でも、閉じ `---` のあと空行が 1 つ、ファイル末尾の LF が 1 つ付く。ファイルは `---\n\n\n` で終わる (閉じ行の LF、空行、本文用の LF)。

値の前後の空白は、この関数では削らない。`a` は `key:  a ` になる (コロンのスペースと、値の先頭スペース)。空文字だけが `key:` になる。これはテストされている (`src/store.test.ts:603-611`)。

### 読む

`parseFrontmatter` (`src/store.ts:787-804`):

1. `\r\n` を `\n` にする。
2. `---\n` で始まらなければ `invalid issue file`。コメントや質問でも文言は同じ。
3. 位置 4 以降で最初の `\n---\n` を閉じとみなす。無ければ `invalid issue file`。
4. 閉じの手前がフィールド、閉じの 5 文字の後ろが本文。本文は先頭の `\n` を 1 つだけ、末尾の `\n` を 1 つだけ削る。
5. フィールドは行ごとに、最初の `:` で割る。`:` が無い行は捨てる。キーも値も `trim` する。同じキーは後の行が勝つ。

次は解釈しない。

- 引用符。`title: "quoted"` の値は、引用符を含む `"quoted"` (`trim` のあと)。
- `#` コメント。`title: hello # note` の値は `hello # note`。
- 型。`true` や `null` や `1` は文字列。
- `|` や `>` の複数行。継続行に `:` が無ければ捨て、あれば別のキーになる。
- アンカー、フロー、インデント。

`---\n---\n` は位置 4 以降に `\n---\n` が無く、`invalid issue file` になる。フィールドが空でも、閉じの前に空行がある `---\n\n---\n` は読める。本文に `\n---\n` があっても、最初の閉じより後ろなので本文の一部である。

一覧 (`listIssues` / `listComments` / `listQuestions`) は、1 件の読み取りが投げた例外を飲み、そのファイルだけを省く (`src/store.ts:182-186`, `src/store.ts:712-716`, `src/questions.ts:633-637`)。`getIssue` / `getComment` / `getQuestion` は飲みこまない。

未知のキーはメモリに残さず、次にそのファイルを保存したとき消える。キーの並びは、保存のたびに下の表の順へ戻す。id はファイル名の幹を書き、frontmatter に書いてあった id が違ってもファイル名は変えない (`src/store.test.ts:96-116`)。

## issue

パスは `.yaru/issues/<id>.md`。id はファイル名の幹 (`src/store.ts:771-774`)。

### キーの順

書く順 (`src/store.ts:836-858`):

| 順  | キー          | 空のとき                    | 値                                                                    |
| --- | ------------- | --------------------------- | --------------------------------------------------------------------- |
| 1   | `id`          | 作らない                    | ファイル名の幹                                                        |
| 2   | `title`       | 作成時は必須                | 1 行。下記                                                            |
| 3   | `status`      | 読むとき欠けていれば `todo` | `backlog` `todo` `in_progress` `done` `canceled` (`src/store.ts:118`) |
| 4   | `assignee`    | `assignee:`                 | 下記                                                                  |
| 5   | `labels`      | `labels:`                   | `", "` で連結                                                         |
| 6   | `dueDate`     | `dueDate:`                  | `YYYY-MM-DD`                                                          |
| 7   | `priority`    | `priority:`                 | `urgent` `high` `medium` `low` (`src/store.ts:16`)                    |
| 8   | `parent`      | `parent:`                   | issue の id                                                           |
| 9   | `blocks`      | `blocks:`                   | `", "` で連結                                                         |
| 10  | `startedAt`   | `startedAt:`                | `toISOString()`                                                       |
| 11  | `completedAt` | `completedAt:`              | 同上                                                                  |
| 12  | `canceledAt`  | `canceledAt:`               | 同上                                                                  |
| 13  | `createdAt`   | `createdAt:`                | 同上。作成時に一度だけ                                                |
| 14  | `updatedAt`   | 更新では必ず入る            | 同上                                                                  |
| 15  | `session`     | `session:`                  | 出どころ。下記                                                        |
| 16  | `worktree`    | `worktree:`                 | 同上                                                                  |
| 17  | `branch`      | `branch:`                   | 同上                                                                  |

この順より後ろに本文がある。`blockedBy` `children` `stale` は書かない (`src/store.ts:191-198`, `src/store.test.ts:690-691`)。

### 例

`git config user.name` が `Spec Author`、時刻 `2026-09-25T09:00:00.000Z` で作成し、`2026-09-25T10:00:00.000Z` に `done` へしたファイル。本文に渡した文字列は、`1 行目`、空行、`2 行目`、末尾の LF である。ファイル末尾は `2 行目` の次の空行で、その空行の LF で終わっている。

```text
---
id: 1
title: 本番: "称号" #1
status: done
assignee: Spec Author
labels: ui, 本番
dueDate: 2026-10-01
priority: high
parent:
blocks:
startedAt: 2026-09-25T09:00:00.000Z
completedAt: 2026-09-25T10:00:00.000Z
canceledAt:
createdAt: 2026-09-25T09:00:00.000Z
updatedAt: 2026-09-25T10:00:00.000Z
session: session-1
worktree: /work/feature
branch: feat/add-thing
---

1 行目

2 行目

```

引用符も `#` もコロンも、title ではエスケープしない。日本語もそのまま書く。

親と blocks がある作成直後の例 (本文は空。閉じ `---` のあと空行が 2 行見えるのは、区切りの空行と、空本文に付く末尾 LF):

```text
---
id: 2
title: child
status: todo
assignee:
labels:
dueDate:
priority:
parent: 1
blocks: 1
startedAt:
completedAt:
canceledAt:
createdAt: 2026-09-25T09:00:00.000Z
updatedAt: 2026-09-25T09:00:00.000Z
session: session-1
worktree: /work/feature
branch: feat/add-thing
---
```

### 値の正規化

時刻は `Date.prototype.toISOString()` (`src/store.ts:249`)。常に UTC で、ミリ秒 3 桁、`Z` 終わり。例: `2026-09-25T09:00:00.000Z`。

作成の時刻は `SaveOptions.now ?? new Date()` (`src/store.ts:248`)。画面からの保存は `provenance` を渡さないので、`session` / `worktree` / `branch` は前の値のまま (`src/store.ts:291-293`, `src/store.test.ts:648-664`)。

`title` は保存入力を `trim` する (`src/store.ts:278`, `src/store.ts:333`)。ファイルへ書く瞬間だけ `\n` を空白 1 文字に置換する (`src/store.ts:840`)。`a\nb` はファイルでは `a b`。`a\n\nb` は `a  b` (空白 2 つ)。前後の空白を潰すのは `\n` の置換ではない。イベントに残る title は置換前である。未決。

`status` は前後の空白を削ってから列挙と照合する (`src/store.ts:431-436`)。大文字は不可。作成時に省略すると `todo` (`src/store.ts:329`)。読むとき、キーが無い、または空なら `todo` (`src/store.ts:811`)。列挙の外は `get` が投げ、一覧はそのファイルを省く (`src/store.test.ts:304-327`)。

`assignee` は `blankToNull` (`src/store.ts:399-405`, `src/store.ts:407-411`)。

- `undefined` は「変更しない」(更新の入力だけ)。
- `null`、`trim` して空、文字列 `none` は `null`。ファイルは `assignee:`。
- 文字列 `me` は、読んだときも書いたときも `git config user.name` に置換する。設定が空なら `me` (`src/store.ts:463-466`)。ファイルに `assignee: me` とあっても、読み取り結果は現在の git の名前である。次の保存でその名前を書く。

`labels` は入力の配列をそのまま持つ。要素の `trim` も重複除去もしない。書き出しは `join(", ")` (`src/store.ts:843`)。読みはカンマで割り、各要素を `trim` し、空を落とす (`src/store.ts:813-816`)。重複は残る。`labels: a, a, b` は `["a", "a", "b"]` で、保存し直しても `a, a, b` のまま。カンマを含む 1 つのラベルは未決。

`dueDate` は `blankToNull` のあと、実在する暦日だけ (`src/store.ts:413-420`, `src/store.ts:454-461`)。形式は `^\d{4}-\d{2}-\d{2}$`。`new Date(年, 月 - 1, 日)` のローカル暦で同じ年月日に戻ることを確かめる。時刻やタイムゾーンは書かない。`2026-02-30` や `2026-08-20T00:00:00Z` は保存しない (`src/store.test.ts:180-190`)。不正な値がファイルにあると、その issue は一覧から消え、`get` は投げる (`src/store.test.ts:264-301`)。期限切れの計算はファイルに書かない (`src/issue-dates.ts:10-16`)。比較はローカルの今日 (`src/store.ts:388-396`)。`done` と `canceled` は遅れにしない (`src/issue-dates.ts:8-16`)。

`priority` は `blankToNull` のあと列挙だけ (`src/store.ts:422-428`)。`none` と空は `null`。大文字は不可。不正なファイル上の値は `dueDate` と同じく一覧から省く。

`parent` は `blankToNull`。自分自身、居ない id、子孫への付け替えは保存しない (`src/store.ts:502-514`)。ファイルには相手の id だけを書く。

`blocks` は id の配列。書き出しは `join(", ")` (`src/store.ts:847`)。読みはカンマ分割、`trim`、空を落とし、重複は先に出た方を残す (`src/store.ts:469-486`)。自分自身、居ない id、既存の辺を逆に辿れる追加は保存しない (`src/store.ts:590-609`)。文字列 `none` は空にしない。カンマ区切りの 1 要素として読む。

`addBlockedBy` / `removeBlockedBy` は、相手の issue の `blocks` と `updatedAt` を書き換える (`src/store.ts:632-644`)。相手の `session` / `worktree` / `branch` は変えない。イベントは相手のファイルに付く (`src/issue-events.test.ts:93-101`)。例: id `3` を id `2` が塞ぐようにすると、`2.md` の `blocks` は `3`、`updatedAt` は保存時刻、`createdAt` は元のまま。

```text
---
id: 2
title: owner
status: todo
assignee:
labels:
dueDate:
priority:
parent:
blocks: 3
startedAt:
completedAt:
canceledAt:
createdAt: 2026-09-25T09:00:00.000Z
updatedAt: 2026-09-25T12:00:00.000Z
session:
worktree:
branch:
---
```

対応するイベントは `events/2.jsonl` の 1 行 (末尾 LF 付き):

```text
{"field":"blocks","from":[],"to":["3"],"by":"Spec Author","session":null,"at":"2026-09-25T12:00:00.000Z"}
```

既に同じ辺がある相手へ再度 `addBlockedBy` したときも、コードは相手を書き、`updatedAt` を進める。`blocks` が同じならイベント行は増えない。これは未決。

`blockedBy` は、他の issue の `blocks` に自分の id があるものを、`readdirSync` の順で集めた id 配列 (`src/store.ts:192-198`)。`children` は `parent` が自分の id のもの、同じ順。どちらもファイルに書かない。順序がファイルシステムに依存することは未決。

### 状態の時刻

`src/store.ts:489-499`。

| フィールド    | ファイルに書く条件                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startedAt`   | 既にあれば保持。無ければ、その保存の status が `in_progress` のときだけ今。一度付くと、status が離れても消さない。作成を `done` で行うと `null` (`src/store.test.ts:530-534`) |
| `completedAt` | status が `done` のときだけ。既に `done` なら前の値。`done` へ入った保存で今。それ以外の status では空                                                                        |
| `canceledAt`  | `completedAt` の `canceled` 版                                                                                                                                                |

読むときは `blankToNull` (`src/store.ts:823-825`)。空と `none` は `null`。ISO であるかは見ない。手で書いた `t` のような文字列は、そのままで、次に規則が書き換えるまで残る。

`createdAt` と `updatedAt` は `blankToNull` しない (`src/store.ts:826-827`)。欠けていれば `""`。文字列 `none` は残る。`updatedAt` は更新のたびに今の時刻へ変わる。追跡フィールドが同じでもファイルは書き換わる。

`stale` は `status === "in_progress"` かつ `now - Date.parse(updatedAt) > staleAfter` (`src/issue-stale.ts:28-37`)。等号では止まっていない (`src/issue-stale.test.ts:51-57`)。`updatedAt` が日時として読めなければ止まっていない。ファイルには書かない。

### 本文

本文は frontmatter の外へ、そのまま書く。前後の空白も改行も削らない。空を許す。

入力の `\n` は残る。書式が末尾に LF を 1 つ足し、読みが末尾の LF を 1 つ削るので、本文自体の末尾 LF は往復する。

`patch` はファイル形式ではない。適用後の本文文字列がファイルに入る (`src/store.ts:289`, `src/store.ts:929-931`)。`body` と同時には渡せない。新規作成には使えない (`src/store.ts:259-260`)。

### 出どころ

`session` / `worktree` / `branch` は作成時、または `provenance` を渡した更新で置き換わる (`src/store.ts:348-350`, `src/store.ts:291-293`)。読むときは `blankToNull` (`src/store.ts:828-830`)。文字列 `none` は `null` になる。これは未決。

値の出どころ (`src/provenance.ts:18-40`):

| フィールド | 取り方                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session`  | 環境変数 `CLAUDE_CODE_SESSION_ID`、空なら `CODEX_SESSION_ID`。`trim` して空なら `null`                                                                                 |
| `worktree` | `git rev-parse --show-toplevel` の標準出力を `trim`。失敗か空なら `null`。linked worktree ではその worktree の最上位で、main ではない (`src/provenance.test.ts:56-63`) |
| `branch`   | `git symbolic-ref --quiet --short HEAD`。detached や git の外は `null` (`src/provenance.test.ts:66-76`)                                                                |

## comment

パスは `.yaru/comments/<id>.md`。id はファイル名の幹。frontmatter の `id` は読まない (`src/store.ts:739-750`)。

書く順 (`src/store.ts:753-764`):

| 順  | キー        | 空のとき                  | 値                                         |
| --- | ----------- | ------------------------- | ------------------------------------------ |
| 1   | `id`        | 作らない                  | ファイル名の幹                             |
| 2   | `issue`     | 読めない                  | issue の id。空なら `invalid comment file` |
| 3   | `parent`    | `parent:`                 | 親コメントの id。`blankToNull`             |
| 4   | `author`    | 読むとき空なら git の名前 | 作成時の `gitName()`。更新では変えない     |
| 5   | `createdAt` | `createdAt:`              | 作成時の `new Date().toISOString()`        |
| 6   | `updatedAt` | 更新で必ず入る            | 同上。作成時は `createdAt` と同じ文字列    |

本文は issue と同じ `formatDocument`。作成時は `trim` して空なら拒否するが、保存する文字列は `trim` しない (`src/store.ts:681-695`)。更新で本文を省くと本文は維持し、`updatedAt` だけ進む (`src/store.ts:669-674`)。

時刻を外から渡す引数は無い (`src/store.ts:661`)。未決。

例 (壁時計が `2026-09-28T05:13:23.576Z` だった実行。本文は `コメント`、LF、`次の行`):

```text
---
id: 1
issue: 1
parent:
author: Spec Author
createdAt: 2026-09-28T05:13:23.576Z
updatedAt: 2026-09-28T05:13:23.576Z
---

コメント
次の行
```

返信は `parent` に親の id を書き、`issue` は親コメントの issue をコピーする (`src/store.ts:677-695`)。

`<!-- yaru:answer -->` はコメントでは区切りではない。本文に含まれていれば本文である。

期限後の回答が issue に写るとき、コメント本文は次の形 (`src/questions.ts:232-239`)。

`defaultAction` があるとき:

```text
Late answer to Q<id> (<title>), after the agent proceeded with the default:

<answer>
```

`defaultAction` が無いとき:

```text
Late answer to Q<id> (<title>), after answerBy passed:

<answer>
```

このコメントは通常の作成なので、author と時刻はコメントの規則に従う。

## event

パスは `.yaru/events/<issue id>.jsonl`。1 行が 1 個の JSON オブジェクトで、行の区切りも末尾も LF (`src/issue-events.ts:59-62`)。[JSON Lines](https://jsonlines.org/) とコメントにあるが、実装は `JSON.stringify` の 1 引数だけである。

作成だけではファイルを作らない (`src/issue-events.test.ts:22-25`)。追跡フィールドが 1 つも変わらなければ追記しない (`src/issue-events.ts:56`, `src/issue-events.test.ts:63-69`)。

追跡するのは次だけ。この順に、変わったものだけを出す (`src/issue-events.ts:12-21`, `src/issue-events.ts:39-47`)。

`title`, `status`, `assignee`, `labels`, `dueDate`, `priority`, `parent`, `blocks`

`labels` と `blocks` の値は配列。それ以外は文字列か `null`。空の配列は `[]` で、`null` ではない。

オブジェクトのキー順は `field`, `from`, `to`, `by`, `session`, `at` (`src/issue-events.ts:60` の `{ ...change, ...context }`)。

| キー      | 値                                          |
| --------- | ------------------------------------------- |
| `field`   | 上の名前                                    |
| `from`    | 保存前                                      |
| `to`      | 保存後のメモリ上の値。title は未決          |
| `by`      | そのときの `gitName()` (`src/store.ts:253`) |
| `session` | `provenance.session`。無ければ `null`       |
| `at`      | その保存の `toISOString()`                  |

`JSON.stringify` は空白を足さない。日本語は `\uXXXX` にしない。`null` は `null`。配列は `[` と `]` の内側に空白が無い。

例 (末尾に LF がある):

```text
{"field":"status","from":"in_progress","to":"done","by":"Spec Author","session":"session-1","at":"2026-09-25T10:00:00.000Z"}
```

`labels` が `[]` から `["ui", "本番"]` になり、session が無いときの 1 行:

```text
{"field":"labels","from":[],"to":["ui","本番"],"by":"Spec Author","session":null,"at":"2026-09-25T09:00:00.000Z"}
```

title を `a` から `b\nc` へ更新したとき、ファイルの title は `b c` だが、イベントの `to` は改行を残す。

```text
{"field":"title","from":"a","to":"b\nc","by":"Spec Author","session":null,"at":"2026-09-25T09:00:00.000Z"}
```

これは未決。

読むとき (`src/issue-events.ts:65-106`):

- issue の `.md` が無ければ `issue not found: <id>`。イベントファイルが無く issue はあるなら空配列。
- 空行は飛ばす。
- `JSON.parse` に失敗した行、オブジェクトでない行、`field` が追跡対象外の行は飛ばす。`from` と `to` は、文字列、`null`、文字列だけの配列、のどれかでなければ飛ばす。`by` か `at` が文字列でない行、`session` が文字列でも `null` でもない行も飛ばす。
- 壊れた行は消さない。次の追記はファイルの末尾に足す (`src/issue-events.test.ts:104-111`)。
- 余分なキーは読み取り結果に含めない。ファイルは追記しかしないので、古い行の余分なキーは残る。
- `\r` は削らない。CRLF の行は JSON として読めず、飛ばす。

## question

パスは `.yaru/questions/<id>.md`。id はファイル名の幹 (`src/questions.ts:642-652`)。

保存される status は `open` と `canceled` だけ (`src/questions.ts:24`, `src/questions.ts:703`)。`answered` と `expired` はファイルに書かない。

### キーの順

書く順 (`src/questions.ts:699-721`):

| 順  | キー                 | 空のとき                               | 値                                                                                                                             |
| --- | -------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `id`                 | 作らない                               | ファイル名の幹                                                                                                                 |
| 2   | `title`              | 必須。無ければ `invalid question file` | 1 行。下記                                                                                                                     |
| 3   | `status`             | 作らない                               | ファイル上は `open` か `canceled`                                                                                              |
| 4   | `issue`              | `issue:`                               | issue の id                                                                                                                    |
| 5   | `priority`           | `priority:`                            | issue と同じ列挙                                                                                                               |
| 6   | `defaultAction`      | `defaultAction:`                       | 1 行                                                                                                                           |
| 7   | `answerBy`           | `answerBy:`                            | `toISOString()`                                                                                                                |
| 8   | `options`            | `options:`                             | JSON 配列。空ならキーだけ                                                                                                      |
| 9   | `author`             | `author:`                              | 作成時の `gitName()`                                                                                                           |
| 10  | `session`            | `session:`                             | 作成時だけ。更新では変えない (`src/questions.test.ts:231-248`)                                                                 |
| 11  | `worktree`           | `worktree:`                            | 同上                                                                                                                           |
| 12  | `branch`             | `branch:`                              | 同上                                                                                                                           |
| 13  | `answeredBy`         | `answeredBy:`                          | 回答時の `gitName()`                                                                                                           |
| 14  | `answeredAt`         | `answeredAt:`                          | 回答時の `toISOString()`                                                                                                       |
| 15  | `acknowledgedAt`     | `acknowledgedAt:`                      | 下記                                                                                                                           |
| 16  | `notifiedExpiringAt` | `notifiedExpiringAt:`                  | 下記                                                                                                                           |
| 17  | `canceledAt`         | `canceledAt:`                          | `canceled` へ移った時刻。既に `canceled` なら保持。`open` に戻すと空 (`src/questions.ts:147`, `src/questions.test.ts:133-144`) |
| 18  | `createdAt`          | `createdAt:`                           | 作成時                                                                                                                         |
| 19  | `updatedAt`          | 通常の更新で進む                       | 下記の例外あり                                                                                                                 |

### 例

回答と受け取りのあと。`status` はファイル上 `open` のまま。`acknowledgedAt` を書いても `updatedAt` は回答の時刻のまま。選択肢の行は `JSON.stringify` そのもの。

```text
---
id: 1
title: 本番 DB の称号を消すか
status: open
issue: 1
priority: high
defaultAction: 消さずに残す
answerBy: 2026-09-25T11:00:00.000Z
options: ["残す","消す, ただし \"本番\" だけ","a\\b"]
author: Spec Author
session: session-1
worktree: /work/feature
branch: feat/add-thing
answeredBy: Spec Author
answeredAt: 2026-09-25T09:05:00.000Z
acknowledgedAt: 2026-09-25T09:06:00.000Z
notifiedExpiringAt:
canceledAt:
createdAt: 2026-09-25T09:00:00.000Z
updatedAt: 2026-09-25T09:05:00.000Z
---

背景の説明
続き

<!-- yaru:answer -->

残す

理由は後で
```

本文が空で回答だけがあるとき。区切りの前に質問本文は無い。

```text
---
id: 2
title: empty body
status: open
issue:
priority:
defaultAction:
answerBy:
options:
author: Spec Author
session:
worktree:
branch:
answeredBy: Spec Author
answeredAt: 2026-09-25T09:00:00.000Z
acknowledgedAt:
notifiedExpiringAt:
canceledAt:
createdAt: 2026-09-25T09:00:00.000Z
updatedAt: 2026-09-25T09:00:00.000Z
---

<!-- yaru:answer -->

yes
```

`canceled` のとき、`status` は `canceled`、`canceledAt` に時刻が入る。回答が無ければ区切り行は無い。

### 回答の区切り

定数は `<!-- yaru:answer -->` (`src/questions.ts:29`)。前後に空白や別の表記は無い。

書くとき (`src/questions.ts:692-698`):

- 回答が `null` なら、本文だけ。区切りは出さない。
- 本文が空でなければ、本文、LF、LF、区切り、LF、LF、回答、の順。
- 本文が空なら、区切り、LF、LF、回答、の順。

読むとき (`src/questions.ts:645-650`):

- 本文中の最初の区切りで割る。2 つ目以降は回答側に残る。
- 質問本文は、区切りの前から末尾の `\n\n` を 1 つだけ削ったもの。
- 回答は、区切りの後ろから先頭の `\n\n` を 1 つだけ削ったもの。
- 区切りが無ければ回答は `null`。空文字ではない。

質問本文と回答は、保存時にこの区切りを含んではいけない (`src/questions.ts:592-596`)。含むと `invalid body: must not contain <!-- yaru:answer -->`。

回答文字列の末尾 LF は往復する。`yes\n` は読み戻しても `yes\n`。

`statusOf` (`src/questions.ts:477-483`):

1. `canceled` フラグ (ファイルの `status` がちょうど `canceled`) なら `canceled`。
2. そうでなく回答が `null` でなければ `answered`。区切りの後ろが空文字でも `answered`。
3. そうでなく `answerBy` が時刻として今以下なら `expired`。
4. それ以外は `open`。

ファイルに `status: answered` とだけ書き、区切りが無い質問は `open` として読む。`status: canceled` 以外は、取り消しではない。

`acknowledgedAt` は、回答済みでまだ空のときだけ今の時刻を書く (`src/questions.ts:343-351`)。`updatedAt` は変えない。もう値があればファイルを書き換えない。回答を置き換えると `null` に戻る (`src/questions.ts:222-228`)。

`notifiedExpiringAt` は知らせた時刻を書く (`src/questions.ts:356-361`)。`updatedAt` は変えない。

取り消し (`undoAnswer`) は回答・回答者・回答時刻・受け取り時刻を空にし、`updatedAt` は進める (`src/questions.ts:299-307`)。条件を満たさないときはファイルを変えない。

### 値の正規化

`title` は `singleLine` (`src/questions.ts:588-590`): `\s*\n\s*` を空白 1 つにし、`trim` する。`a\n\nb` は `a b`。issue の title とは置換が違う。未決。

`defaultAction` は `blankToNull` のあと `singleLine` (`src/questions.ts:582-586`)。`none` と空は `null`。

`options` の各要素は `singleLine`。空と重複は保存しない (`src/questions.ts:512-530`)。書くときは要素が 1 つ以上あるときだけ `JSON.stringify(配列)` (`src/questions.ts:708`)。空白は足さない。読むときは値を `trim` してから `JSON.parse` し、文字列の配列でなければ `invalid question file` (`src/questions.ts:678-689`)。空の値は `[]`。

`answerBy` (`src/questions.ts:549-572`):

- `blankToNull`。`none` と空は `null`。
- `^(\d+)([mhd])$` なら、今からのミリ秒。`m` は 60_000、`h` は 3_600_000、`d` は 86_400_000。暦日ではない。`0h` は 0 として通り、`toISOString()` は今と一致する。`staleAfter` は 0 を拒む。未決。
- そうでなく `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$` に合い、`Date.parse` できるなら `new Date(parsed).toISOString()`。`2026-09-30T18:00:00+09:00` は `2026-09-30T09:00:00.000Z`。`2026-09-30T09:00:00.5Z` は `2026-09-30T09:00:00.500Z`。日付だけ、空白、小文字の `t` や `z` は拒む。
- 時刻の引数は `saveQuestion` の `now` (`src/questions.ts:118-122`)。既定は `new Date()`。

`issue` は `blankToNull`。id を書くときは、その issue ファイルが読めなければならない (`src/questions.ts:575-579`)。

`priority` は issue と同じ `resolvePriority`。

`author` は `meta.author || ""` (`src/questions.ts:659`)。空は空のまま。`none` は残る。コメントのように git の名前へは落とさない。

`session` / `worktree` / `branch` の読みは `blankToNull`。作成時だけ `provenance` をコピーする (`src/questions.ts:167-169`)。作業場所は CLI の `process.cwd()` から読む。`store.root` は main を指すので、そこからは取らない (`src/questions.ts:69-70`)。

## config.yml

パスは `.yaru/config.yml`。`init` は 0 バイトを書く (`src/store.ts:172`)。その後、yaru はこのファイルを書き戻さない。手で書いたバイトは、次の `init` が拒否される限り残る (`src/store.ts:169`)。

読み (`src/config.ts:9-18`):

- ファイルが無ければ `null`。
- LF で行に分ける。CRLF の置換はしない。値の `trim` が末尾の `\r` を落とす。
- 行が `<key>:` で始まる最初の行を採用する。インデントされた行は一致しない。
- 値はプレフィックスの後ろを `trim` したもの。空なら `null` を返し、次の行は見ない (`src/config.test.ts:14-25`)。
- `:` は最初のプレフィックスだけが区切り。値の中の `:` は値に含める。
- `#` も引用符も YAML として扱わない。

コードが読むキーは 3 つだけ。他のキーがあってもエラーにせず、書き戻しも無い。

| キー         | 読む場所                   | メモリ上の扱い                                      |
| ------------ | -------------------------- | --------------------------------------------------- |
| `staleAfter` | `src/issue-stale.ts:23-25` | 下記。無ければ 24 時間 (`src/issue-stale.ts:8`)     |
| `notify`     | `src/notify.ts:33`         | 空でなければ、`sh -c` に渡すコマンド文字列          |
| `publicUrl`  | `src/notify.ts:34`         | 末尾の `/` をメモリ上だけで削る。ファイルは変えない |

`staleAfter` の値は `trim` のあと `^(\d+)([mhd])$` で、数値部分が 1 以上 (`src/issue-stale.ts:12-20`)。`30m`、`2h`、`90m`、`3d` は通る。`24`、`1w`、`0h`、`1.5h` は通らない (`src/issue-stale.test.ts:31-36`)。単位は `answerBy` と同じミリ秒。

`listIssues` と `getIssue` は `readStaleAfter` を呼ぶ (`src/store.ts:207`, `src/store.ts:236`)。値が不正なら、その 1 件を省くのではなく、呼び出し全体が失敗する。

issue の保存は、書く前に必ずこれを呼び、不正なら何も書かない (`src/store.ts:252`, `src/store.test.ts:694-699`)。コメントの新規と、`issue` を伴う質問の保存は、`getIssue` を通るので同じ失敗になる (`src/store.ts:680`, `src/questions.ts:575-578`)。コメント本文だけの更新と、`issue` を伴わない質問の保存は、`readStaleAfter` を呼ばない (`src/store.ts:662-674`, `src/questions.ts:575-576`)。

`notify` に渡す JSON はファイルには残さない。標準入力へ出すだけ (`src/notify.ts:59-66`)。

## git で管理するもの

yaru が gitignore を書くのは `questions/.gitignore` の `*\n` だけ (`src/questions.ts:598-606`)。

この 1 行は、そのディレクトリの中身と、この `.gitignore` 自身を無視する。テストは `git status --porcelain --untracked-files=all` に `questions` が出ないことを見ている (`src/questions.test.ts:453-462`)。ルールは、質問を作った作業ツリーにファイルができたときから効く。コミットされるのは、誰かが既に追跡している場合を除き、このファイル自身ではない。

| パス               | コードが gitignore するか                |
| ------------------ | ---------------------------------------- |
| `.yaru/config.yml` | しない                                   |
| `.yaru/issues/`    | しない                                   |
| `.yaru/comments/`  | しない                                   |
| `.yaru/events/`    | しない                                   |
| `.yaru/questions/` | `questions/.gitignore` の `*` で無視する |

`events/` をリポジトリに入れるかは、コードも `AGENTS.md` も「管理する」とは書いていない。`AGENTS.md` は、質問は git に入れず、issue とコメントは git で管理する、とだけ書く。未決。

保存の一時ファイルは gitignore しない。

| 対象                            | 一時パス                                    | 出典                      |
| ------------------------------- | ------------------------------------------- | ------------------------- |
| issue・コメント・質問の置き換え | `<元のパス>.tmp` (pid は付かない)           | `src/store.ts:781-784`    |
| 新規作成                        | 一時ファイルは使わず `wx`                   | `src/store.ts:777-778`    |
| `workspaces.json`               | `workspaces.json.<pid>.tmp` のあと `rename` | `src/workspaces.ts:35-38` |
| `notified-stale-issues.json`    | 同上                                        | `src/notify.ts:171-174`   |

成功したあとに残るのは置き換え後の本体だけ。一時ファイルの名前を Go が変えても、本体のバイトには影響しない。同じ `*.md.tmp` を同時に書く競合は未決。

## worktree

linked worktree の中では、その worktree にチェックアウトされた `.yaru` ではなく、main worktree 側の `.yaru` を読む (`src/store.ts:132-158`)。

`findRoot(start)`:

1. `start` が存在しなければ、写像はしない。
2. `git rev-parse --path-format=absolute --show-toplevel --git-common-dir` を `start` で実行する。失敗なら写像しない。
3. 標準出力を `trim` し、最初の LF で 2 つに分ける。worktree の最上位と common dir。どちらか欠けたら写像しない。
4. common dir のベース名が `.git` でなければ写像しない。bare リポジトリから作った worktree はここへ入る (`src/store.ts:146-147`)。
5. main の最上位は common dir の親。それが worktree の最上位と同じなら、今いるのが main なので写像しない。
6. `realpath(start)` から親へ登る。worktree 最上位からの相対が `..` で始まったら諦め、登り切っても `.yaru/config.yml` が無ければ諦める。
7. 相対パスを main の最上位へ足した場所に `.yaru/config.yml` があれば、そこがワークスペースのルート。サブディレクトリの `.yaru` は、worktree 内の同じ相対位置へ写る (`src/store.test.ts:740-743`)。

写像できなければ、`start` から親へ、`.yaru/config.yml` が見つかるまで登る (`src/store.ts:123-129`)。ファイルシステムの根まで無ければ `not a yaru workspace (run yaru init)`。

`open` は登らない。渡された root の直下だけを見る (`src/store.ts:161-164`)。

`init` は `findRoot` を使わず、渡されたディレクトリに `.yaru` を作る (`src/store.ts:167`)。CLI は `process.cwd()` に作る (`src/index.ts:344`)。

シンボリックリンクで git の最上位と `realpath` がずれ、写像に失敗したあと、worktree 側のコピーを掴む場合は未決。テストは `realpath` が一致する配置だけを見ている (`src/store.test.ts:718-737`)。

provenance の `worktree` は、この写像とは別である。書いたプロセスの cwd の worktree 最上位を記録する (`src/provenance.ts:24`)。質問のコメントが、`store.root` からは取らない、と書いている (`src/questions.ts:69-70`)。

## 状態ディレクトリ

ワークスペースの登録と、止まった issue を知らせ済みである印は、`.yaru` の外に置く。

場所 (`src/workspaces.ts:18-21`):

1. 環境変数 `YARU_STATE_DIR` が真なら、その文字列そのもの。末尾に `yaru` は足さない。
2. そうでなく `XDG_STATE_HOME` が真なら、`<XDG_STATE_HOME>/yaru`。
3. どちらも空なら `<homedir>/.local/state/yaru`。

空文字は JavaScript では偽なので、1 にも 2 にも入らない。

このディレクトリにコードが書くファイルは次の 2 つだけ。

### workspaces.json

`registerWorkspace` が書く (`src/workspaces.ts:24-39`)。`JSON.stringify(registry, null, 2)` のあと LF を 1 つ。

形は `{ "workspaces": [ { "slug", "root" }, ... ] }`。新規要素のキー順は `slug`, `root`。既存要素は `JSON.parse` が残したキー順と余分なキーを、次の保存でも保持する。`slug` と `root` が両方文字列でない要素は、次に登録を書いたとき落ちる (`src/workspaces.ts:63-66`)。

例 (`src/workspaces.test.ts:33-35` が期待する形):

```json
{
  "workspaces": [
    {
      "slug": "AsukaTravel",
      "root": "/path/to/AsukaTravel"
    }
  ]
}
```

slug (`src/workspaces.ts:28-31`, `src/workspaces.ts:74-76`):

- 既に同じ `root` があれば、その slug を返し、ファイルは書き換えない。
- 新規は `basename(root)` を `[^A-Za-z0-9._-]+` の連続で `-` にし、先頭と末尾の `-` を削る。空なら `workspace`。
- 使用中の slug なら `-2`, `-3`, … を足す。登録順に決める (`src/workspaces.test.ts:38-45`)。
- `my project#1` は `my-project-1` (`src/workspaces.test.ts:48-51`)。
- フォルダ名「やる」は、ASCII の外が 1 つの `-` になり、端を削ると空なので `workspace`。

`.yaru/config.yml` が消えた root は一覧から外す。ファイル上の登録は消さない。slug は再利用しない (`src/workspaces.ts:42-46`, `src/workspaces.test.ts:54-60`)。

ファイルが無いときは `{ workspaces: [] }` として扱い、一覧は空 (`src/workspaces.ts:59`)。JSON が壊れているときも空として扱い、次の登録で新しい中身を上書きする (`src/workspaces.ts:68-70`)。

`listWorkspaces` は、登録のうち `config.yml` がまだあるものだけ、ファイルに書いてある順で返す。

### notified-stale-issues.json

`notifyStaleIssues` が書く (`src/notify.ts:114-175`)。同じ `JSON.stringify(..., null, 2)` と末尾 LF。

キーは `<workspace.root>#<issue.id>`。値は、そのとき止まっていると判定した issue の `updatedAt` 文字列。

オブジェクトのキー順は、`listWorkspaces` の順、その中では `listIssues` の順 ( `updatedAt` の降順、同じなら id の降順。`src/store.ts:208`) のうち、`in_progress` かつ `stale` なものだけ。

同じ root と id で、保存してある `updatedAt` と一致する間は知らせ直さない (`src/notify.ts:130`)。もう止まっていないキーは、オブジェクトを作り直して消す。`JSON.stringify` の結果が前と同じなら書き戻さない (`src/notify.ts:142-144`)。

読むとき、ファイルが無い、JSON でない、オブジェクトでない (配列はオブジェクトなので要素が文字列なら残る)、値が文字列でないキー、は落とす (`src/notify.ts:152-166`)。配列をどう扱うかは未決。

例:

```json
{
  "/path/to/workspace#12": "2026-09-25T09:00:00.000Z"
}
```

質問の `notifiedExpiringAt` は質問ファイル側にあり、この JSON には入らない。

## .yaru に書かないもの

次は形式の一部ではない。Go が `.yaru` の中へ対応するファイルを新しく作らない。

セッションログは Claude Code の `~/.claude/projects/<パス>` にある JSONL を読むだけ (`src/sessions.ts:5-7`, `src/sessions.ts:86-89`)。パスは root の `/` と `.` を `-` に置換したディレクトリ名。yaru はそこへ書かない。issue と質問の `session` は、このファイル名 (拡張子なし) と突き合わせるための文字列である。探す id は `^[A-Za-z0-9_-]+$` だけ (`src/sessions.ts:137-138`)。Codex のセッションはこのディレクトリに無く、見つからなければ `null` (`src/sessions.ts:131`)。

`src/repository.ts` は git の標準出力を読むだけで、`.yaru` に書かない。issue の `branch` は、`refs/heads/<branch>` が 1 つのコミットに解決できたときだけ、その履歴を辿るための文字列である (`src/repository.ts:97-105`)。

## 未決

ここにあるものは、仕様として採用しない。Go で挙動を良くしない。バイトを今の TypeScript と揃える実装は、観測どおりに分裂したままにするしかない、という記録である。

1. issue の title は、ファイルでは `\n` を空白に置換し、読み戻した値もその空白になる。同じ保存のイベント `to` は置換前 (trim だけ) で、`b\nc` が残る (`src/store.ts:278`, `src/store.ts:840`, `src/issue-events.ts:39-46`)。質問の title は保存前に `singleLine` なのでファイルとメモリが一致する (`src/questions.ts:588-590`)。どちらへ揃えるかは決まっていない。
2. ラベルは `", "` 連結とカンマ分割である (`src/store.ts:813-816`, `src/store.ts:843`)。入力 `["a, b", "c"]` はファイル `labels: a, b, c` になり、読み戻すと `["a", "b", "c"]` になる。カンマを含むラベルを拒否するのか、別の書き方にするのかは決まっていない。`blocks` は重複を落とすが、ラベルは落とさない。
3. `blankToNull` は文字列 `none` を空と同じにする (`src/store.ts:399-404`)。assignee、dueDate、priority、parent、質問の defaultAction と answerBy では、クリアの合言葉としてテストがある。同じ関数を、session、worktree、branch、startedAt、completedAt、canceledAt、質問の issue や回答者にも使っている。セッション id が `none` のとき消してよいかは決まっていない。createdAt、updatedAt、title、author は `none` を特別扱いしない。
4. `answerBy` の `0h` は今と同じ時刻になる (`src/questions.ts:560-564`)。`staleAfter` の `0h` はエラー (`src/issue-stale.ts:15-19`)。0 を揃えるかは決まっていない。
5. `addBlockedBy` / `removeBlockedBy` は、辺が変わらなくても相手ファイルの `updatedAt` を進める (`src/store.ts:570-587`, `src/store.ts:641`)。イベントは diff が空なら増えない。無変更の相手を触るかは決まっていない。
6. `blockedBy` と `children` の順は `readdirSync` の順 (`src/store.ts:192-198`)。id 順などの安定した順は決まっていない。ファイルのバイトには出ない。
7. 採番の `Number` が安全な整数を超えたときの次 id は決まっていない (`src/store.ts:363`)。やり直しの上限も無い。
8. 数字以外のファイル名は読めるが、作成 API は発行しない (`src/page.test.ts:167-172`)。Go の作成がそれを拒否するのかは、読み取りの寛容さとしては決まっていても、作成の契約としてはこのソースが「禁止」と書いてはいない。保存関数が数字しか作らない、が観測である。
9. コメントの時刻は `new Date()` 固定で、issue の `SaveOptions.now` や質問の `now` に相当する引数が無い (`src/store.ts:661`)。この worktree には `YARU_NOW` が無い。揃えるかは P0-clock 側の仕事で、ここでは決めない。
10. `events/` を git に入れるかは決まっていない。gitignore は書かない (`src/issue-events.ts:57-62`)。
11. issue の一時ファイルは `<path>.tmp` で pid が無く、状態ファイルの一時名には pid がある (`src/store.ts:782`, `src/workspaces.ts:36`)。同時書き込みの勝者は決まっていない。
12. 写像に失敗した linked worktree が、自分のツリーにチェックアウトされた `.yaru` を掴むフォールバック (`src/store.ts:120-129`) を、意図した仕様とするかは決まっていない。
13. `notified-stale-issues.json` が JSON 配列だったとき、JavaScript ではオブジェクトとして要素を拾う (`src/notify.ts:156-162`)。配列を拒否するかは決まっていない。
14. 不正な UTF-8 を U+FFFD に置換するかどうかは、Node のデコーダ任せで、契約としては書いていない。
