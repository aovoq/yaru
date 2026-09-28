# サーバの突き合わせの記録

`internal/server/wire_compare_test.go` の `TestWiredServerMatchesTypeScriptServe` は、つないだ Go のサーバと TS 版の `yaru serve` が同じ返事をするかを確かめる。TS 版の返事は、ここの記録から読む。

TS 版は消したので、記録が正解になる。Go 版の振る舞いを意図して変えたときは、テストの期待と記録を手で直す。

## 記録の形

`<テスト名>.json`。

| キー        | 中身                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `responses` | 場面の名前 (`list issues`、`page` など) ごとの TS 版の返事。`status` と `body`                        |
| `files`     | TS 版に書かせたファイル。`ts-copy/.yaru/issues/2.md` は `POST /p/ts-copy/api/issues` で作らせた issue |

テストの一時ディレクトリ (`t.TempDir` が `001`、`002` と番号を振る親) は `<TEMP>` にしてある。実パスと `/var` の表記の両方を替える。

## 取り直すとき

記録を取る仕組みは、コミット 530206f (`サーバの突き合わせを TS 版の返事の記録で動かせるようにする`) の `wire_compare_test.go` にある。TS 版は `ts-final` のタグに残っている。

1. `ts-final` を checkout した worktree に、530206f の `internal/server/wire_compare_test.go` を置く
2. `YARU_RECORD_TYPESCRIPT=1 go test ./internal/server/ -run TestWiredServerMatchesTypeScriptServe` で TS の `yaru serve` (bun、ポート 47901) を動かして記録を書く
3. 2 回続けて取り、同じになることを確かめる
