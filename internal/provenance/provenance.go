// 質問や issue をどのエージェントがどの作業場所で作ったか。TS 版の src/provenance.ts
// セッションは環境変数、作業場所は git から読む
// https://git-scm.com/docs/git-rev-parse#Documentation/git-rev-parse.txt---show-toplevel
package provenance

// Provenance は書き込んだ時点の出どころ。無いものは nil (TS 版の null)
// src/provenance.ts:6-13
type Provenance struct {
	Session  *string
	Worktree *string
	Branch   *string
}

// Read は TS 版の readProvenance。workingDirectory は CLI を動かした場所で、ワークスペースの root ではない
// 環境変数は先に CLAUDE_CODE_SESSION_ID、次に CODEX_SESSION_ID。空白だけの値は無いものとして飛ばす (src/provenance.ts:18-35)
func Read(workingDirectory string, environment []string) Provenance {
	panic("not implemented: provenance.Read")
}
