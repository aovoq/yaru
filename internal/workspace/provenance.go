//declscope:core

package workspace

import (
	"context"

	"github.com/aovoq/yaru/internal/document"
)

// Provenance は書き込んだ時点の出どころ。TS 版の src/provenance.ts の Provenance
// セッションは人が手で叩いたとき nil。worktree と branch は git の外や detached なら nil
type Provenance struct {
	Session  *string
	Worktree *string
	Branch   *string
}

// 先に並べたものを優先する。Claude Code を Codex の中から呼ぶことは無いので、順番は見つかりやすさで決めている
// src/provenance.ts:16
var sessionEnvironmentVariables = []string{"CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID"}

// ReadProvenance は TS 版の readProvenance と同じく、セッションと git の作業ツリーとブランチを読む
// environment は呼び出し側が渡す。nil は空。linked worktree ではその worktree を返し、main には写さない
// src/provenance.ts:18-40 docs/spec/yaru-format.md の「出どころ」
// https://git-scm.com/docs/git-rev-parse#Documentation/git-rev-parse.txt---show-toplevel
func ReadProvenance(ctx context.Context, workingDirectory string, environment map[string]string) (Provenance, error) {
	if environment == nil {
		environment = map[string]string{}
	}
	worktree, err := gitText(ctx, workingDirectory, "rev-parse", "--show-toplevel")
	if err != nil {
		return Provenance{}, err
	}
	branch, err := gitText(ctx, workingDirectory, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil {
		return Provenance{}, err
	}
	return Provenance{
		Session:  readSession(environment),
		Worktree: worktree,
		Branch:   branch,
	}, nil
}

func readSession(environment map[string]string) *string {
	for _, name := range sessionEnvironmentVariables {
		value, found := environment[name]
		if !found {
			continue
		}
		trimmed := document.Trim(value)
		if trimmed != "" {
			return &trimmed
		}
	}
	return nil
}
