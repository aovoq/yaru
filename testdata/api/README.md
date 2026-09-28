# API の突き合わせの記録

`internal/api/handler_test.go` の `*MatchesTypeScript` などのテストと、`internal/api/api_test.go` の `TestMatchesTypeScriptFiles` は、TS 版の Web (`src/web.tsx` の JSON とフォーム、`src/notify.ts` の知らせ) と Go 版の API が同じ振る舞いをするかを確かめる。TS 版の答えは、ここの記録から読む。

TS 版は消したので、記録が正解になる。Go 版の振る舞いを意図して変えたときは、テストの期待と記録を手で直す。

## 記録の形

`<テスト名>/<番号>-<動作>.json`。番号はテストの中で TS 版を呼んだ順。

| キー      | 中身                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| `payload` | TS 版の動作の結果。HTTP なら `status`・`body`・`location`                     |
| `root`    | 動作の直後の TS 側のワークスペースの全ファイル。`.git` と `.lock` は除く      |
| `state`   | 動作の直後の状態ディレクトリの全ファイル。`workspaces.json` と `.lock` は除く |

テストは `root` と `state` をワークスペースと状態ディレクトリへ書き戻し (記録に無いファイルは消す)、TS 版が動いたあとの状態を再現する。

毎回変わるパスは置き換え文字にしてある。

| 記録での文字     | 実際の値                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `<TEMP>`         | テストの一時ディレクトリ (`t.TempDir` が `001`、`002` と番号を振る親)。実パスと `/tmp` の表記 |
| `<TEMP-ENCODED>` | 同じパスの `/` と `.` を `-` にしたもの (Claude のセッションのディレクトリ名)                 |

## 取り直すとき

記録を取る仕組みは、コミット 622f814 (`API の突き合わせを TS 版の答えの記録で動かせるようにする`) の `handler_test.go` にある。TS 版は `ts-final` のタグに残っている。

1. `ts-final` を checkout した worktree に、622f814 の `internal/api/handler_test.go` を置く
2. `YARU_RECORD_TYPESCRIPT=1 go test ./internal/api/` で TS 版 (bun) を動かして記録を書く
3. 2 回続けて取り、`diff -r` で同じになることを確かめる

`TestMatchesTypeScriptFiles/01-issue-and-comment.json` は記録モードを持たない。622f814 の `api_test.go` の `typeScriptOracle` (bun) を動かしたあと、TS 側のワークスペースを同じ形 (`root` だけ) で書いた。
