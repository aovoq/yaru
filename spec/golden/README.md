# CLI の golden

今の TS 版の CLI の振る舞いを「正解」として記録し、あとから別の実装 (Go 版) に同じ場面を流して、バイト単位で同じかを確かめる。場面と記録は JSON で、ランナーの言語には依存しない。

記録するものは、各手順の標準出力・標準エラー・終了コードと、最後の `.yaru` の全ファイル、`YARU_STATE_DIR` の全ファイル。

## 動かし方

リポジトリの根で実行する。

```sh
bun spec/golden/run.ts --update
bun spec/golden/run.ts --check
```

`--update` は `spec/golden/snapshots/<場面の名前>.json` を書き直す。`--check` は記録と突き合わせ、差があれば場面・手順・どの出力か (標準出力、標準エラー、終了コード、`.yaru` のファイル、状態ディレクトリのファイル) を出して終了コード 1 で終わる。差が無ければ終了コード 0。

場面の名前を後ろに付けると、その場面だけを対象にする。

```sh
bun spec/golden/run.ts --check issue-create-list-get
```

## Go 版

`YARU_BIN` に実行ファイルのパスを 1 つ渡す。既定は `bun --jsx-import-source=preact <リポジトリ>/src/index.ts` である。Bun は JSX の設定を作業ディレクトリの tsconfig からしか読まないので、この指定が無いとリポジトリの外で `react/jsx-dev-runtime` を探して落ちる。

```sh
YARU_BIN=/path/to/yaru bun spec/golden/run.ts --check
```

`YARU_BIN` は引数を含まない。引数が要るときは、それを包んだ実行ファイルを渡す。

ランナーは毎回、プロジェクトの外の一時ディレクトリをワークスペースにし、別の一時ディレクトリを `YARU_STATE_DIR` にする。本物の `.yaru` と `~/.local/state` は読み書きしない。

## 場面の書き方

`spec/golden/scenarios/<名前>.json`。名前は小文字と数字をハイフンでつないだもので、ファイル名と `name` を同じにする。

```json
{
  "name": "issue-create-list-get",
  "description": "何を記録する場面か",
  "setup": {
    "gitUser": { "name": "golden", "email": "golden@example.com" },
    "files": [{ "path": "README.md", "content": "latch\n" }],
    "commits": [{ "message": "initial", "paths": ["README.md"] }],
    "worktrees": [{ "name": "feature", "branch": "feat/add-thing" }]
  },
  "steps": [
    {
      "arguments": ["init"],
      "stdin": "",
      "environment": {},
      "now": "2026-09-28T12:00:00.000Z",
      "workingDirectory": "."
    }
  ]
}
```

準備は毎回行う。

- 一時ディレクトリで `git init --initial-branch=main` する。ブランチ名は `main` に固定する
- `gitUser` を省略すると `user.name` は `golden`、`user.email` は `golden@example.com`
- `files` はワークスペースの中への相対パス。絶対パスと、外へ出る `..` は拒む
- `commits` はそのファイルを commit する。`paths` を省略すると全体を commit する。作者の日付は `2026-09-28T00:00:00Z` に固定する
- `worktrees` は linked worktree を作る。commit が 1 つも無いと失敗する

手順のフィールド。

| フィールド         | 意味                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `arguments`        | `yaru` の後ろに続く引数                                                                                          |
| `stdin`            | 標準入力。省略すると空                                                                                           |
| `environment`      | この手順だけ足す環境変数。親の環境は渡さない                                                                     |
| `now`              | `YARU_NOW` に渡す ISO 8601 の日時 (RFC 3339)                                                                     |
| `workingDirectory` | `.` はワークスペースの根。`worktree:<名前>` は準備で作った linked worktree。それ以外はワークスペース内の相対パス |

`now` を付けない手順は、実行した瞬間の時刻を使う。ファイルに時刻を書くコマンドは、手順ごとに `now` を付ける。

親プロセスの `YARU_STATE_DIR`、`YARU_NOW`、`CLAUDE_CODE_SESSION_ID`、`CODEX_SESSION_ID` は子に渡さない。セッションを記録したいときは、その手順の `environment` に書く。手順から `YARU_STATE_DIR` はセットできない。

## 正規化

記録に書く前に、次の文字列を置き換える。長いパスから先に置き換える。macOS で `/var` と `/private/var` のように実パスが違っても、同じ置き換え文字にする。

| 実際のパス         | 記録での文字      |
| ------------------ | ----------------- |
| ワークスペースの根 | `<WORKSPACE>`     |
| `YARU_STATE_DIR`   | `<STATE>`         |
| linked worktree    | `<WORKTREE:名前>` |
| このリポジトリの根 | `<REPOSITORY>`    |

ワークスペースのディレクトリ名は常に `workspace` なので、登録ファイルの slug は `workspace` になる。

空のディレクトリはファイルが無いので記録に出ない。シンボリックリンクがあると、その場で失敗する。中身は UTF-8 として読む。

## 場面を増やすとき

1. `scenarios/<名前>.json` を足す
2. 時刻を書くコマンドには、すべての手順に `now` を付ける
3. `--assignee me` やコメントの作者は、準備で入れた `git config user.name` (`golden`) になる。マシンの git の名前は使わない
4. `issue save` と `question save` を人向けの出力 (`-f` / `--format`) にしない。人向けの保存だけ、動いている `yaru serve` に問い合わせて URL を足すことがあり、その URL はサーバの有無で変わる。JSON (既定) には URL は出ない
5. `bun spec/golden/run.ts --update <名前>` のあと、記録に絶対パスや、自分のユーザー名や、セッション ID が残っていないかを見る
6. `bun spec/golden/run.ts --check <名前>` を 2 回連続で通し、1 回目の記録のまま 2 回目が一致することを確かめる
