//declscope:core
package api

import (
	"context"
	"fmt"
	"time"

	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

// openRegistered は登録の slug からワークスペースを開く。無い slug は TS 版と同じ文。
// 渡された stateDirectory を使い、環境変数は重ねて読まない。
// src/web.tsx:564-574 、src/workspaces.ts:49-50 。
func openRegistered(ctx context.Context, stateDirectory string, slug string) (workspace.Workspace, error) {
	registered, found := workspace.Find(ctx, slug, stateDirectory)
	if !found {
		return workspace.Workspace{}, fmt.Errorf("workspace not found: %s", slug)
	}
	return workspace.Open(ctx, registered.Root)
}

func questionDirectory(opened workspace.Workspace) questions.Directory {
	return questions.Directory{Dir: opened.Directory}
}

// storeIssues は質問の期限後の回答を、issue のコメントへ写す。
// src/questions.ts:236-245 、src/store.ts:661-662 。
type storeIssues struct {
	space workspace.Workspace
}

func (records storeIssues) GetIssue(ctx context.Context, directory questions.Directory, id string, now time.Time, author string) error {
	_, err := store.GetIssue(ctx, records.space, id, now, author)
	return err
}

func (records storeIssues) SaveComment(ctx context.Context, directory questions.Directory, issueID string, body string, now time.Time, author string) error {
	_, err := store.SaveComment(ctx, records.space, store.SaveCommentInput{
		Issue: &issueID,
		Body:  &body,
	}, now, author)
	return err
}
